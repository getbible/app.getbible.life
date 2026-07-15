import type { Metadata } from "next";
import Home from "../../../page";

export async function generateMetadata({ params }: { params: Promise<{ translation: string; book: string; chapter: string }> }): Promise<Metadata> {
  const { translation, book, chapter } = await params;
  const bookName = decodeURIComponent(book).replace(/-/g, " ");
  return {
    title: `${bookName} ${chapter} · ${translation.toUpperCase()} · getBible.Life`,
    description: `Read ${bookName} chapter ${chapter} in ${translation.toUpperCase()} on getBible.Life.`,
  };
}

export default Home;
