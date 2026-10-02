# Operación y seguridad

## Despliegue

El entorno usa `rimac`, stage `demo` y región `us-east-1`, centralizados en `infra/config.ts`. Los valores ficticios de empaquetado están separados de los ARN obtenidos de CloudFormation.

1. Ejecutar lint, tipos, formato, cobertura, OpenAPI y empaquetado. DynamoDB Local y MySQL deben estar disponibles para cobertura.
2. Subir el commit candidato. Esperar CI y Snyk satisfactorios sobre ese SHA. CI audita los hallazgos completos de Sonar; el indicador de código nuevo por sí solo no basta.
3. Para cambios de infraestructura base, usar `AWS_PROFILE=oliver` en el entorno y `pnpm exec tsx scripts/infra-changes.ts plan data`. Revisar `delivery/data-changes.json`: solo altas o modificaciones sin sustitución. Ejecutar con `execute data` y esperar `UPDATE_COMPLETE` antes de continuar. Los otros destinos admitidos son `cost` y `github`.
4. Si se creó el secreto Swagger, establecer la contraseña mediante el procedimiento siguiente.
5. Ejecutar el workflow manual **Deploy demo** sobre el mismo commit. Comprueba ambos análisis, ejecuta pruebas, migra y despliega. `pnpm smoke` verifica ambos países, duplicados, conflictos y paginación.
6. Comprobar Swagger sin credencial, con credencial inválida y válida; incluir `/swagger/openapi.json` y los recursos estáticos. Comprobar en navegador GET y POST de Try it out.

El script de cambios bloquea eliminaciones y sustituciones. Para desmontar o ejecutar otro cambio destructivo se necesita una revisión explícita distinta. Los ZIP anteriores de la aplicación mantienen sus rutas internas; Swagger agrega `swagger.zip`.

## Credencial de Swagger

Secrets Manager conserva `rimac/demo/swagger`, con campos `username` y `password`. El usuario es `admin`. CloudFormation genera una contraseña inicial aleatoria; no se incrustan credenciales elegidas en las plantillas.

Para establecer o rotar la contraseña, proporcionar `SWAGGER_PASSWORD` por un mecanismo privado de la terminal y ejecutar:

```sh
pnpm exec tsx scripts/swagger-secret.ts
```

Sin `SWAGGER_PASSWORD`, el mismo script establece el usuario `admin` y conserva la contraseña actual. Para ello necesita también `secretsmanager:GetSecretValue`. Si se cambia `GenerateSecretString` en CloudFormation, AWS genera una contraseña nueva: al migrar el usuario se debe conservar la versión anterior en Secrets Manager y restablecer su contraseña mediante el SDK, sin imprimirla ni guardarla en archivos.

La identidad operadora necesita leer las salidas del stack y `secretsmanager:PutSecretValue` sobre ese secreto. Retirar la variable del entorno al terminar. No escribir la contraseña en comandos que queden en el historial, archivos versionados, capturas ni logs. La rotación se refleja como máximo en 60 segundos por instancia activa.

HTTP Basic se usa sobre HTTPS. La comparación aplica SHA-256 y `timingSafeEqual`; las respuestas llevan `no-store`, CSP y protección de framing. No hay sesiones persistentes ni credenciales dentro de OpenAPI. El navegador puede recordar Basic hasta cerrar su contexto; no existe un botón de cierre de sesión del servidor. Ante un secreto compartido comprometido, rotarlo y cerrar los contextos del navegador.

La API de citas sigue siendo pública y exclusivamente demostrativa. El control de Swagger no autentica los endpoints de negocio. Las llamadas Try it out omiten credenciales; solo el contrato de documentación se descarga con autenticación del mismo origen.

## Monitoreo y hallazgos

Las alarmas cubren errores de Lambda, errores controlados, DLQ y antigüedad del outbox. Los logs de fallos indican fase, cita, correlación disponible y nombres de errores; excluyen cuerpos, claves e identificadores de asegurados. Swagger registra únicamente el nombre del error de infraestructura.

El bucket de artefactos exige HTTPS, tiene versionado y envía logs a un bucket privado independiente con SSE-S3. Los logs y las versiones no actuales expiran a los siete días; los artefactos actuales necesarios para despliegue y rollback se conservan. El receptor no genera logs sobre sí mismo para evitar recursión, según [AWS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/enable-server-access-logging.html).

El tema SNS de alertas usa una clave KMS propia con rotación y permisos acotados para CloudWatch y Budgets. Aurora conserva siete días de backups, cifrado, acceso privado y pausa automática. Las operaciones IAM que exigen `Resource: "*"` se separan de las que admiten ARN concretos; `infra/security-context.json` documenta el hallazgo contextual admitido, sin desactivar reglas.

Cada cierre debe distinguir:

- **Corregido y verificado:** configuración y comportamiento respaldados por pruebas o evidencia AWS.
- **Justificado por contexto:** hallazgo residual identificado y explicado individualmente.
- **Pendiente:** entrega real de logs de S3 o notificaciones que aún no cuenten con evidencia. Configurar el destino no demuestra su entrega; el quality gate tampoco sustituye esa comprobación.

Los informes de ejecución quedan en `delivery/`, fuera de Git. No almacenar allí valores de secretos. La sustitución acotada de `uri-js` mediante `fast-uri` se mantiene en `pnpm-workspace.yaml`; se comprueban compatibilidad Ajv, ESLint y análisis completo Snyk con dependencias de desarrollo.

## Costes

El presupuesto de USD 10 mensual es una alerta, no un límite de gasto. Aurora puede cobrar cómputo cuando está activa; la pausa no elimina almacenamiento, backups u otros servicios.

- Una clave KMS propia añade aproximadamente USD 1/mes, más solicitudes: [precios KMS](https://aws.amazon.com/kms/pricing/).
- El secreto adicional de Swagger añade aproximadamente USD 0,40/mes, más lecturas: [precios Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/). La caché reduce llamadas por instancia activa, no globalmente.
- Hay cargos variables por S3 y versiones, logs, alarmas, DynamoDB, API Gateway, Lambda, SNS, SQS, EventBridge y Aurora. El paquete Swagger y su alarma añaden uso; el total depende del tráfico y del tiempo de actividad.

Revisar Cost Explorer y Budgets después de desplegar. Las cifras indicadas son orientativas y no una estimación cerrada del coste mensual.

## Rollback y desmontaje

Antes de desplegar, conservar el commit, paquetes y plantillas anteriores junto con la revisión del change set. Para rollback de aplicación, desplegar un artefacto previamente verificado o el commit anterior mediante el proceso de análisis y despliegue. Mantener el secreto y los recursos de datos: quitar rutas Swagger no exige borrar el secreto ni modificar Aurora o DynamoDB. Una rotación de contraseña se revierte operativamente estableciendo una nueva versión autorizada del secreto.

Antes de desmontar, exportar los datos necesarios y revisar retenciones, snapshots y versiones S3. Eliminar primero la aplicación, después la infraestructura de datos y finalmente los recursos de despliegue y costes que hayan dejado de usarse. Aurora tiene política de snapshot; los snapshots retenidos, secretos en periodo de recuperación, buckets no vacíos y versiones pueden seguir generando costes. Revisar explícitamente esos recursos residuales antes de dar el desmontaje por terminado.
