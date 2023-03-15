import {
  ApiError,
  ApiResponse,
  CustomRequestInit,
  Fetch,
  FetchConfig,
  Method,
  Middleware,
  OpArgType,
  OpenapiPaths,
  OpErrorType,
  Request,
  _TypedFetch,
  TypedFetch,
  OpContentType,
  ContentType,
} from './types'

const sendBody = (method: Method) =>
  method === 'post' ||
  method === 'put' ||
  method === 'patch' ||
  method === 'delete'

function queryString(params: Record<string, unknown>): string {
  const qs: string[] = []

  const encode = (key: string, value: unknown) =>
    `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`

  Object.keys(params).forEach((key) => {
    const value = params[key]
    if (value != null) {
      if (Array.isArray(value)) {
        value.forEach((value) => qs.push(encode(key, value)))
      } else {
        qs.push(encode(key, value))
      }
    }
  })

  if (qs.length > 0) {
    return `?${qs.join('&')}`
  }

  return ''
}

function getPath(path: string, payload: Record<string, any>) {
  return path.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = encodeURIComponent(payload[key])
    delete payload[key]
    return value
  })
}

function getQuery(
  method: Method,
  payload: Record<string, any>,
  query: string[],
) {
  let queryObj = {} as any

  if (sendBody(method)) {
    query.forEach((key) => {
      queryObj[key] = payload[key]
      delete payload[key]
    })
  } else {
    queryObj = { ...payload }
  }

  return queryString(queryObj)
}

function getHeaders(
  body: string | FormData | undefined,
  init: HeadersInit | undefined,
  contentType: ContentType | undefined,
) {
  const headers = new Headers(init)

  if (
    body !== undefined &&
    !headers.has('Content-Type') &&
    contentType !== 'multipart/form-data'
  ) {
    headers.append('Content-Type', contentType || 'application/json')
  }

  if (!headers.has('Accept')) {
    headers.append('Accept', 'application/json')
  }

  return headers
}

function getBody(
  method: Method,
  payload: any,
  contentType: ContentType | undefined,
) {
  let body: any = undefined

  if (sendBody(method)) {
    if (contentType === 'multipart/form-data') {
      const formData = new FormData()

      Object.entries(payload).forEach(([key, value]) => {
        formData.append(key, value as File | Blob)
      })

      body = formData
    } else {
      body = JSON.stringify(payload)
    }
  }

  // if delete don't send body if empty
  return method === 'delete' && body === '{}' ? undefined : body
}

function mergeRequestInit(
  first?: RequestInit,
  second?: RequestInit,
): RequestInit {
  const headers = new Headers(first?.headers)
  const other = new Headers(second?.headers)

  for (const key of other.keys()) {
    const value = other.get(key)
    if (value != null) {
      headers.set(key, value)
    }
  }
  return { ...first, ...second, headers }
}

function getFetchParams(request: Request) {
  // clone payload
  // if body is a top level array [ 'a', 'b', param: value ] with param values
  // using spread [ ...payload ] returns [ 'a', 'b' ] and skips custom keys
  // cloning with Object.assign() preserves all keys
  const payload = Object.assign(
    Array.isArray(request.payload) ? [] : {},
    request.payload,
  )

  const path = getPath(request.path, payload)
  const query = getQuery(request.method, payload, request.queryParams)
  const body = getBody(request.method, payload, request.contentType)
  const headers = getHeaders(body, request.init?.headers, request.contentType)
  const url = request.baseUrl + path + query

  const init = {
    ...request.init,
    method: request.method.toUpperCase(),
    headers,
    body,
  }

  return { url, init }
}

async function getResponseData(response: Response) {
  const contentType = response.headers.get('content-type')
  if (response.status === 204 /* no content */) {
    return undefined
  }
  if (contentType && contentType.indexOf('application/json') !== -1) {
    return await response.json()
  }
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch (e) {
    return text
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<ApiResponse> {
  const response = await fetch(url, init)

  const data = await getResponseData(response)

  const result = {
    headers: response.headers,
    url: response.url,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    data,
  }

  if (result.ok) {
    return result
  }

  throw new ApiError(result)
}

function wrapMiddlewares(middlewares: Middleware[], fetch: Fetch): Fetch {
  type Handler = (
    index: number,
    url: string,
    init: CustomRequestInit,
  ) => Promise<ApiResponse>

  const handler: Handler = async (index, url, init) => {
    if (middlewares == null || index === middlewares.length) {
      return fetch(url, init)
    }
    const current = middlewares[index]
    return await current(url, init, (nextUrl, nextInit) =>
      handler(index + 1, nextUrl, nextInit),
    )
  }

  return (url, init) => handler(0, url, init)
}

async function fetchUrl<R>(request: Request) {
  const { url, init } = getFetchParams(request)

  const response = await request.fetch(url, init)

  return response as ApiResponse<R>
}

function createFetch<OP, C>(fetch: _TypedFetch<OP, C>): TypedFetch<OP, C> {
  const fun = async (payload: OpArgType<OP, C>, init?: RequestInit) => {
    try {
      return await fetch(payload, init)
    } catch (err) {
      if (err instanceof ApiError) {
        throw new fun.Error(err)
      }
      throw err
    }
  }

  fun.Error = class extends ApiError {
    constructor(error: ApiError) {
      super(error)
      Object.setPrototypeOf(this, new.target.prototype)
    }
    getActualType() {
      return {
        status: this.status,
        data: this.data,
      } as OpErrorType<OP>
    }
  }

  return fun
}

type AAA<Paths, P extends keyof Paths> = <
  M extends keyof Paths[P],
  C extends OpContentType<Paths[P][M]>,
>(
  ...args: Paths[P][M] extends { requestBody?: { content: infer D } }
    ? keyof D extends ContentType
      ? [M, keyof D]
      : [M, keyof D]
    : [M]
) => {
  create: (queryParams?: Record<string, true | 1>) => TypedFetch<Paths[P][M], C>
}

function fetcher<Paths>() {
  let baseUrl = ''
  let defaultInit: RequestInit = {}
  const middlewares: Middleware[] = []
  const fetch = wrapMiddlewares(middlewares, fetchJson)

  return {
    configure: (config: FetchConfig) => {
      baseUrl = config.baseUrl || ''
      defaultInit = config.init || {}
      middlewares.splice(0)
      middlewares.push(...(config.use || []))
    },
    use: (mw: Middleware) => middlewares.push(mw),
    path: <P extends keyof Paths>(path: P) => ({
      method: ((method, contentType) => ({
        create: (queryParams) =>
          createFetch((payload, init) =>
            fetchUrl({
              baseUrl: baseUrl || '',
              path: path as string,
              method: method as Method,
              queryParams: Object.keys(queryParams || {}),
              payload,
              init: mergeRequestInit(defaultInit, init),
              fetch,
              contentType: contentType as ContentType | undefined,
            }),
          ),
      })) as AAA<Paths, P>,
    }),
  }
}

export const Fetcher = {
  for: <Paths extends OpenapiPaths<Paths>>() => fetcher<Paths>(),
}
