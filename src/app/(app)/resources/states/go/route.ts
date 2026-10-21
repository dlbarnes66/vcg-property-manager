import { NextResponse } from "next/server";
import { isStateCode } from "@/lib/states";

/** The state picker submits here (GET ?code=XX) and lands on that state's page. */
export function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  return NextResponse.redirect(new URL(isStateCode(code) && code !== "US" ? `/resources/states/${code}` : "/resources/states", url));
}
