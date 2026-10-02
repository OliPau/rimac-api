# API de citas RIMAC

Demo de registro asíncrono de citas para Perú y Chile con TypeScript, AWS Lambda y arquitectura hexagonal. Utilizar únicamente datos ficticios.

`POST /appointments` confirma la persistencia con `202`; el procesamiento por país termina después. `GET /appointments/{insuredId}` permite consultar el estado `pending` o `completed`.

## Preparación

Requisitos: Node.js 24, pnpm 11.21.0 y Docker para las pruebas de integración. `mise.toml` fija la versión exacta de Node del repositorio; `package.json` fija pnpm mediante `packageManager`.

```sh
mise install
mise exec -- node --version
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm check
pnpm coverage
```

Activar mise en la terminal o ejecutar los comandos dentro de `mise exec --`. Las pruebas usan DynamoDB Local en `localhost:8000` y MySQL en `localhost:3307`. Si esos puertos ya están ocupados por los contenedores de este proyecto, reutilizarlos.

## Swagger

En el despliegue, abrir **`<HttpApiUrl>/swagger/`**. El navegador solicita autenticación HTTP Basic: usuario `swagger` y contraseña entregada por un canal privado. La contraseña se almacena en Secrets Manager; no forma parte del repositorio, del contrato OpenAPI ni de los paquetes.

La página, los recursos estáticos y `/swagger/openapi.json` requieren autenticación. **Try it out ejecuta GET y POST reales**; POST puede crear citas ficticias. Las credenciales de la documentación no se incluyen en esas llamadas a la API pública.

Para validar y exportar el contrato sin AWS:

```sh
pnpm openapi
```

El resultado queda en `delivery/openapi.json`, generado desde los mismos esquemas Zod utilizados por la aplicación. La copia servida por Swagger usa el origen de la API. `API_URL` permite especificar un servidor en la exportación local.

## Verificación

| Comando               | Comprobación                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `pnpm lint`           | Reglas ESLint, límites entre capas y ausencia de ciclos                     |
| `pnpm typecheck`      | TypeScript estricto                                                         |
| `pnpm test`           | Pruebas unitarias y de configuración                                        |
| `pnpm integration`    | Transacciones, concurrencia y recuperación con DynamoDB Local y MySQL       |
| `pnpm coverage`       | 100 % de líneas y ramas por archivo ejecutable de `src/`                    |
| `pnpm format`         | Formato consistente                                                         |
| `pnpm openapi`        | Contrato OpenAPI válido                                                     |
| `pnpm bundle`         | Compilación de Lambdas y recursos de Swagger                                |
| `pnpm package`        | Cinco ZIP inspeccionados y paquete Serverless; requiere acceso a Serverless |
| `pnpm infra:validate` | Generación de recursos para validación de CloudFormation                    |

La cobertura es un requisito de ejecución de pruebas, no una garantía de ausencia de defectos. Las pruebas incluyen escenarios de error, duplicados, cursores inválidos, continuidad del outbox y caducidad de credenciales.

## Despliegue y documentación

El workflow manual **Deploy demo** exige CI y Snyk satisfactorios para el mismo commit. CI comprueba también los hallazgos completos de Sonar, además del quality gate. AWS se autentica mediante OIDC y la configuración Serverless se genera como JSON para funcionar en Windows.

- [Arquitectura y responsabilidades](docs/arquitectura.md)
- [Flujos y diagramas de secuencia](docs/flujos.md)
- [Operación, seguridad, costes y rollback](docs/operacion.md)

README y `docs/` se versionan. Las evidencias operativas, paquetes y resultados de análisis quedan fuera de Git en `delivery/`, `.local/` y `coverage/`. Los comentarios del código se reservan para decisiones que no pueden expresarse claramente con nombres y estructura.
