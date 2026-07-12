import { redirect } from "next/navigation";

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
