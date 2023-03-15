export type Method =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options'

export type OpenapiPaths<Paths> = {
  [P in keyof Paths]: {
    [M in Method]?: unknown
  }
}

export type OpContentType<OP> = OP extends {
  requestBody?: {
    content: infer C
  }
}
  ? keyof C
  : never

type AllowBlobValueWhenMultipart<
  A,
  C extends ContentType,
> = C extends 'multipart/form-data'
  ? {
      [K in keyof A]: A[K] extends string | undefined | null
        ? A[K] | Blob
        : A[K]
    }
  : A

export type OpArgType<OP, C> = OP extends {
  parameters?: {
    path?: infer P
    query?: infer Q
    body?: infer B
    header?: unknown // ignore
    cookie?: unknown // ignore
  }
  // openapi 3
  requestBody?: {
    content: infer RB
  }
}
  ? P &
      Q &
      (B extends Record<string, unknown> ? B[keyof B] : unknown) &
      (C extends ContentType
        ? RB extends Record<C, unknown>
          ? AllowBlobValueWhenMultipart<RB[C], C>
          : Record<string, never>
        : Record<string, never>)
  : Record<string, never>

type OpResponseTypes<OP> = OP extends {
  responses: infer R
}
  ? {
      [S in keyof R]: R[S] extends { schema?: infer S } // openapi 2
        ? S
        : R[S] extends { content: { 'application/json': infer C } } // openapi 3
        ? C
        : S extends 'default'
        ? R[S]
        : unknown
    }
  : never

type _OpReturnType<T> = 200 extends keyof T
  ? T[200]
  : 201 extends keyof T
  ? T[201]
  : 'default' extends keyof T
  ? T['default']
  : unknown

export type OpReturnType<OP> = _OpReturnType<OpResponseTypes<OP>>

type _OpDefaultReturnType<T> = 'default' extends keyof T
  ? T['default']
  : unknown

export type OpDefaultReturnType<OP> = _OpDefaultReturnType<OpResponseTypes<OP>>

// private symbol to prevent narrowing on "default" error status
const never: unique symbol = Symbol()

type _OpErrorType<T> = {
  [S in Exclude<keyof T, 200 | 201>]: {
    status: S extends 'default' ? typeof never : S
    data: T[S]
  }
}[Exclude<keyof T, 200 | 201>]

type Coalesce<T, D> = [T] extends [never] ? D : T

// coalesce default error type
export type OpErrorType<OP> = Coalesce<
  _OpErrorType<OpResponseTypes<OP>>,
  { status: number; data: any }
>

export type CustomRequestInit = Omit<RequestInit, 'headers'> & {
  readonly headers: Headers
}

export type Fetch = (
  url: string,
  init: CustomRequestInit,
) => Promise<ApiResponse>

export type _TypedFetch<OP, C> = (
  arg: OpArgType<OP, C>,
  init?: RequestInit,
) => Promise<ApiResponse<OpReturnType<OP>>>

export type TypedFetch<OP, C> = _TypedFetch<OP, C> & {
  Error: new (error: ApiError) => ApiError & {
    getActualType: () => OpErrorType<OP>
  }
}

export type FetchArgType<F> = F extends TypedFetch<infer OP, unknown>
  ? OpArgType<OP, unknown>
  : never

export type FetchReturnType<F> = F extends TypedFetch<infer OP, unknown>
  ? OpReturnType<OP>
  : never

export type FetchErrorType<F> = F extends TypedFetch<infer OP, unknown>
  ? OpErrorType<OP>
  : never

type _CreateFetch<OP, C, Q = never> = [Q] extends [never]
  ? () => TypedFetch<OP, C>
  : (query: Q) => TypedFetch<OP, C>

export type CreateFetch<M, OP, C> = M extends
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  ? OP extends { parameters: { query: infer Q } }
    ? _CreateFetch<OP, C, { [K in keyof Q]: true | 1 }>
    : _CreateFetch<OP, C>
  : _CreateFetch<OP, C>

export type Middleware = (
  url: string,
  init: CustomRequestInit,
  next: Fetch,
) => Promise<ApiResponse>

export type FetchConfig = {
  baseUrl?: string
  init?: RequestInit
  use?: Middleware[]
}

export type Request = {
  baseUrl: string
  method: Method
  path: string
  queryParams: string[] // even if a post these will be sent in query
  payload: any
  init?: RequestInit
  fetch: Fetch
  contentType?: ContentType
}

export type ContentType =
  | 'application/json'
  | 'multipart/form-data'
  | 'application/x-www-form-urlencoded'

export type ApiResponse<R = any> = {
  readonly headers: Headers
  readonly url: string
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  readonly data: R
}

export class ApiError extends Error {
  readonly headers: Headers
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly data: any

  constructor(response: Omit<ApiResponse, 'ok'>) {
    super(response.statusText)
    Object.setPrototypeOf(this, new.target.prototype)

    this.headers = response.headers
    this.url = response.url
    this.status = response.status
    this.statusText = response.statusText
    this.data = response.data
  }
}
