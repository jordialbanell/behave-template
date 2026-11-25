import { redirect } from "next/navigation";

// The app lives at /projects/behave (same paths as on your-site.com, so nothing inside needed rewriting).
export default function Home() {
  redirect("/projects/behave");
}
