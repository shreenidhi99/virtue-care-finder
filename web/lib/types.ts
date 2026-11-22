// Shapes shared by the server routes and the browser. Nothing here carries ids, keys,
// model fields or SQL: the server strips those before an answer leaves it.

export type Quote = { text: string; source: string | null };

export type FacilityCard = {
  rank: string | null;
  name: string;
  distance: string | null; // "31.2 km"
  place: string | null; // "Tirunelveli, 627001"
  confidence: number | null; // whole percent
  broadened: boolean; // no record mentions the exact service: a broader match
  quotes: Quote[];
  whyNotCloser: string | null;
  locationNote: string | null;
  backup: string | null; // "Name (12.0 km)"
  phone: string | null;
  tel: string | null;
  directionsUrl: string;
};

export type AnswerResult =
  | { kind: "facilities"; cards: FacilityCard[]; broadened: boolean }
  | { kind: "table"; columns: string[]; rows: (string | null)[][]; note?: string };

export type Answer = {
  text: string | null; // Genie's own words (markdown), as the Genie UI shows them
  result: AnswerResult | null;
  suggestions: string[];
  conversationId: string | null;
  error: string | null;
};

export type GenieEvent =
  | { type: "progress"; stage: string; thoughts: string[] }
  | { type: "ping" }
  | { type: "answer"; answer: Answer };
