import { redirect } from "next/navigation";

// The War Room dashboard was the paused desk's home page and was removed with it.
// The copilot starts at the advisor.
export default function Home() {
  redirect("/advisor");
}
