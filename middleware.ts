import { createClient as createSupabaseMiddleware } from './utils/supabase/middleware';
import { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    return createSupabaseMiddleware(request);
}

export const config = {
    matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
