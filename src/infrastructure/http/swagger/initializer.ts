interface SwaggerRequest {
  url: string;
  headers: Record<string, string>;
  credentials?: string;
}

export function requestInterceptor(request: SwaggerRequest): SwaggerRequest {
  const url = new URL(request.url, globalThis.location.href);
  const documentation =
    url.origin === globalThis.location.origin && url.pathname === '/swagger/openapi.json';
  request.credentials = documentation ? 'same-origin' : 'omit';
  for (const name of Object.keys(request.headers)) {
    if (name.toLowerCase() === 'authorization') {
      delete request.headers[name];
    }
  }
  return request;
}

declare global {
  var SwaggerUIBundle: (options: Record<string, unknown>) => unknown;
}

globalThis.SwaggerUIBundle({
  url: '/swagger/openapi.json',
  dom_id: '#swagger-ui',
  layout: 'BaseLayout',
  validatorUrl: null,
  queryConfigEnabled: false,
  persistAuthorization: false,
  supportedSubmitMethods: ['get', 'post'],
  requestInterceptor,
});
