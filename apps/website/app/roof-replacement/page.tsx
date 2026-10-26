import type {Metadata} from "next";
import {SearchLandingPage} from "../search/search-landing-page";
import {searchPageMetadata, searchPages} from "../search/search-pages";

const page = searchPages["roof-replacement"];

export const metadata: Metadata = searchPageMetadata(page);

export default function Page() {
  return <SearchLandingPage page={page} />;
}
