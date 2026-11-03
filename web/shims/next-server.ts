// `next/server` for the browser build: the slice the route handlers use.

export class NextResponse<T = unknown> extends Response {
  declare readonly __body?: T;

  static json<T>(body: T, init?: ResponseInit): NextResponse<T> {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse<T>(JSON.stringify(body), { ...init, headers });
  }

  static redirect(url: string | URL, status = 307): NextResponse {
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }

  static next(): NextResponse {
    return new NextResponse(null, { status: 200 });
  }
}

interface RequestCookie {
  name: string;
  value: string;
}

export class NextRequest extends Request {
  readonly nextUrl: URL;
  readonly cookies: {
    get(name: string): RequestCookie | undefined;
    getAll(): RequestCookie[];
    has(name: string): boolean;
  };

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(this.url);
    this.cookies = { get: () => undefined, getAll: () => [], has: () => false };
  }
}
