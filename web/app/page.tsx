/**
 * Root route — redirects to the terminal.
 * The protected layout handles unauthenticated users.
 */
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/terminal");
}
