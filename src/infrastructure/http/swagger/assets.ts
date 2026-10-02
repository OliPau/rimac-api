export const swaggerAssets = [
  {
    route: '/swagger/index.html',
    file: 'static/swagger/index.html',
    type: 'text/html; charset=utf-8',
  },
  {
    route: '/swagger/swagger-ui.css',
    file: 'static/swagger/swagger-ui.css',
    type: 'text/css; charset=utf-8',
  },
  {
    route: '/swagger/swagger-ui-bundle.js',
    file: 'static/swagger/swagger-ui-bundle.js',
    type: 'text/javascript; charset=utf-8',
  },
  {
    route: '/swagger/initializer.js',
    file: 'static/swagger/initializer.js',
    type: 'text/javascript; charset=utf-8',
  },
  {
    route: '/swagger/openapi.json',
    file: 'static/swagger/openapi.json',
    type: 'application/json; charset=utf-8',
  },
] as const;
export type SwaggerAsset = (typeof swaggerAssets)[number];
