import { redirect } from "next/navigation";

// Stock Advisor merged into AI Analysis as its "long-term" mode — keep this
// route alive so old links/bookmarks still land somewhere useful.
export default function InvestRedirect() {
  redirect("/analyze?mode=long");
}
