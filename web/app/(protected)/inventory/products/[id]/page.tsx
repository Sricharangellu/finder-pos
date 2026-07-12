import { redirect } from "next/navigation";

export default function InventoryProductRedirect({ params }: { params: { id: string } }) {
  redirect(`/catalog/${params.id}`);
}
