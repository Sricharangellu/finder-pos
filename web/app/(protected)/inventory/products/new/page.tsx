import { redirect } from "next/navigation";

// Product creation lives on the catalog page (New Product modal).
export default function NewInventoryProductRedirect({
  searchParams,
}: {
  searchParams?: { parent?: string };
}) {
  if (searchParams?.parent) {
    redirect(`/catalog/${searchParams.parent}`);
  }
  redirect("/catalog?new=product");
}
