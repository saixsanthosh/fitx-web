import type { Metadata } from "next";

type PublicPageMetadata = {
  title: string;
  description: string;
  path: `/${string}` | "/";
};

/** Keep public titles, canonicals, and share cards aligned page by page. */
export function publicPageMetadata({ title, description, path }: PublicPageMetadata): Metadata {
  const shareTitle = `${title} | FITX`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: shareTitle,
      description,
      type: "website",
      siteName: "FITX",
      url: path,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "FITX fitness and training" }],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: ["/opengraph-image"] },
  };
}
