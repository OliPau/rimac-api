# Flujos de ejecución

## Registro y aceptación durable

```mermaid
sequenceDiagram
    autonumber
    participant Client as Cliente
    participant API as HTTP y caso de uso
    participant DB as DynamoDB
    participant SNS as SNS
    Client->>API: POST /appointments + clave opcional
    API->>API: Validar entrada e idempotencia
    API->>DB: Transacción: cita, clave y outbox
    DB-->>API: Aceptación persistida
    API->>DB: Reclamar publicación con bloqueo temporal
    alt Publicación disponible
        API->>SNS: Publicar appointment.requested
        SNS-->>API: Confirmación
        API->>DB: Marcar envío
    else Fallo de publicación
        API->>DB: Reprogramar intento
        API->>API: Registrar fase y nombres de errores
    end
    API-->>Client: 202 con aceptación original pending
```

Un fallo anterior al commit no confirma aceptación. Una vez persistida la transacción, un fallo de publicación no cambia el `202`. Si SNS aceptó el evento y falla marcar el envío, se conserva el bloqueo hasta que venza: una repetición posterior es segura por idempotencia.

## Procesamiento por país y confirmación

```mermaid
sequenceDiagram
    autonumber
    participant SNS as SNS
    participant Queue as SQS PE o CL
    participant Worker as Worker del país
    participant SQL as Aurora MySQL
    participant Bus as EventBridge
    participant Confirmation as SQS de confirmación
    participant API as Lambda appointment
    participant DB as DynamoDB
    SNS->>Queue: Evento filtrado por countryISO
    Queue->>Worker: Lote de eventos
    Worker->>SQL: Transacción: cita y confirmación pendiente
    SQL-->>Worker: Resultado idempotente
    Worker->>Bus: appointment.completed
    Worker->>SQL: Marcar confirmación publicada
    Bus->>Confirmation: Entregar confirmación
    Confirmation->>API: Lote de confirmaciones
    API->>DB: Cambiar estado a completed
```

Si EventBridge falla después del commit SQL, el reintento reutiliza la confirmación persistida. Cada consumidor devuelve únicamente los identificadores de mensajes fallidos mediante `ReportBatchItemFailures`; las colas y DLQ mantienen la recuperación de entregas.

## Recuperación del outbox

```mermaid
sequenceDiagram
    autonumber
    participant Schedule as Programación
    participant Retry as Lambda retry
    participant DB as Outbox DynamoDB
    participant SNS as SNS
    participant Logs as CloudWatch
    Schedule->>Retry: Una ejecución por minuto
    Retry->>DB: Consultar hasta 25 elementos vencidos
    loop Cada elemento aislado
        Retry->>DB: Reclamar bloqueo temporal
        alt Reclamo disponible
            Retry->>SNS: Publicar evento
            alt SNS confirma
                Retry->>DB: Marcar envío
            else SNS falla
                Retry->>DB: Reprogramar
                Retry->>Logs: Fase y causas, incluida recuperación fallida
            end
        else Reclamo omitido o fallido
            Retry->>Retry: Contabilizar y continuar
        end
    end
    Retry->>Logs: Intentados, enviados, omitidos, fallidos y antigüedad
```

Las cancelaciones transaccionales de DynamoDB se clasifican antes de reintentar: conflictos y condiciones de concurrencia pueden recuperarse; los errores permanentes de validación o tamaño fallan inmediatamente. Sin razones detalladas se conserva el máximo de ocho intentos.

## Consulta y documentación

GET valida el asegurado y el tamaño de página. El cursor debe ser base64url canónico, contener JSON válido y un UUID válido, y corresponder al mismo asegurado. Un cursor inválido devuelve `400 INVALID_CURSOR`.

Los errores de validación incluyen `error.details`, una lista de campos con mensajes que explican la regla incumplida. Un cuerpo con varios campos incorrectos devuelve todos sus errores sin reproducir los valores enviados. JSON mal formado usa `INVALID_JSON`; los campos, encabezados o parámetros inválidos usan `INVALID_REQUEST`. Los errores internos siguen respondiendo sin detalles técnicos sensibles.

```mermaid
sequenceDiagram
    participant Browser as Navegador
    participant Docs as Lambda Swagger
    participant Secrets as Secrets Manager
    participant API as API de citas
    Browser->>Docs: GET /swagger/index.html
    Docs->>Secrets: Leer credencial si la caché caducó
    Docs-->>Browser: 401 y desafío Basic
    Browser->>Docs: GET con credencial
    Docs-->>Browser: HTML, assets y OpenAPI protegidos
    Browser->>API: Try it out: GET o POST sin credencial de Swagger
    API-->>Browser: Resultado de la operación
```

La caché dura como máximo 60 segundos. Si Secrets Manager falla después de su vencimiento, Swagger responde `503` sin reutilizar el secreto vencido. La redirección de `/swagger` a `/swagger/index.html` ocurre antes del desafío para acotar el ámbito de autenticación del navegador a `/swagger/`. API Gateway HTTP API no admite declarar una ruta con el segmento final vacío; las rutas desplegadas son `/swagger` y `/swagger/{proxy+}`.
