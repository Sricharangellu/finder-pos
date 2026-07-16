import { redirect } from "next/navigation";

// Product management lives in one place: the catalog product page.
// This legacy inventory editor duplicated it (with an inconsistent variant
// flow) — old URLs and bookmarks land on the canonical page instead.
export default function LegacyInventoryProductRedirect({ params }: { params: { id: string } }) {
  redirect(`/catalog/${params.id}`);
}
