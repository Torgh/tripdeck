import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional HTTP Basic auth for public deployments: set APP_PASSWORD (and optionally
 * APP_USERNAME) to require a login. Without APP_PASSWORD the app is open, which is fine locally.
 */
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const username = process.env.APP_USERNAME || "tripdeck";
  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const sep = decoded.indexOf(":");
    if (sep >= 0 && safeEqual(decoded.slice(0, sep), username) && safeEqual(decoded.slice(sep + 1), password)) {
      return NextResponse.next();
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="TripDeck", charset="UTF-8"' },
  });
}

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = {
  // Static PWA assets stay public so browsers can fetch them without credentials.
  matcher: ["/((?!_next/static|_next/image|manifest.webmanifest|sw.js|icon.svg|favicon.ico).*)"],
};
