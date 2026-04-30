import { getAuthUrl } from "@/lib/integrations/google";
import { NextResponse } from "next/server";

export async function GET() {
  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
