import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const restaurantEnabled = process.env.NEXT_PUBLIC_ENABLE_RESTAURANT === 'true';
const offlineModeEnabled = process.env.NEXT_PUBLIC_ENABLE_OFFLINE_MODE === 'true';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!restaurantEnabled && pathname.startsWith('/restaurant')) {
    return NextResponse.redirect(new URL('/pos', request.url));
  }

  if (!offlineModeEnabled && pathname.startsWith('/~offline')) {
    return NextResponse.redirect(new URL('/pos', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/restaurant/:path*', '/~offline/:path*'],
};
