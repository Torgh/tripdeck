import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { structured } from "@/lib/server/claude";
import { searchPlaces, type PlaceResult } from "@/lib/server/maps";
import { handle, HttpError, readBody } from "@/lib/server/http";

export const maxDuration = 120;

const MAX_FILE_BASE64 = 14_000_000; // ~10 MB file

const schema = z.object({
  text: z.string().max(60_000).optional(),
  file: z
    .object({
      mediaType: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
      data: z.string().max(MAX_FILE_BASE64),
    })
    .optional(),
  destination: z.string().max(200).optional(),
  tripStartDate: z.string().optional(),
});

const bookingSchema = z.object({
  type: z.enum(["stay", "activity", "transport", "dive", "food", "place"]),
  title: z.string().describe('Short card title, e.g. "Hotel Phoenicia" or "Comino boat trip".'),
  provider: z.string().nullable().describe("Booking.com, GetYourGuide, Viator, Airbnb, airline name, dive centre..."),
  reference: z.string().nullable().describe("Booking / confirmation number."),
  date: z.string().nullable().describe("Start date YYYY-MM-DD (check-in date for stays)."),
  start_time: z.string().nullable().describe("Start / meeting / departure time HH:MM, 24h."),
  duration_min: z.number().int().nullable(),
  nights: z.number().int().nullable().describe("Stays only."),
  location_query: z
    .string()
    .nullable()
    .describe(
      "Text to find the place on Google Maps: name + address, or the meeting point. For flights the departure airport.",
    ),
  price: z.string().nullable().describe("Total price with currency, as written."),
  url: z.string().nullable(),
  transport_kind: z
    .string()
    .nullable()
    .describe("Transport only: flight, ferry, train, bus, car_rental, boat or other."),
  from: z.string().nullable(),
  to: z.string().nullable(),
  number: z.string().nullable().describe("Flight / train number."),
  notes: z
    .string()
    .nullable()
    .describe("Key practical info: what to bring, cancellation deadline, meeting instructions."),
});

const outputSchema = z.object({ bookings: z.array(bookingSchema) });

export type ImportedBooking = z.infer<typeof bookingSchema> & { place?: PlaceResult };

const SYSTEM = `You extract travel bookings from confirmation emails, PDFs and screenshots (Booking.com, GetYourGuide, Viator, Airbnb, airlines, ferries, dive centres...).
Return one entry per distinct booking. A round-trip flight is two entries. Leave fields null when the document does not state them; never guess booking numbers, dates or prices.
Ignore marketing content, upsells and unrelated recommendations.`;

export const POST = handle(async (req) => {
  const input = await readBody(req, schema);
  if (!input.text?.trim() && !input.file) throw new HttpError(400, "Paste the confirmation text or attach a file.");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.file) {
    content.push(
      input.file.mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.file.data } }
        : { type: "image", source: { type: "base64", media_type: input.file.mediaType, data: input.file.data } },
    );
  }
  content.push({
    type: "text",
    text: [
      "Extract the bookings from this confirmation.",
      input.destination ? `The trip is to ${input.destination}.` : "",
      input.tripStartDate ? `The trip starts on ${input.tripStartDate} (use it to resolve dates without a year).` : "",
      input.text ? `\n<confirmation>\n${input.text}\n</confirmation>` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const { bookings } = await structured({ system: SYSTEM, content, schema: outputSchema, effort: "low" });

  const located: ImportedBooking[] = await Promise.all(
    bookings.map(async (b) => {
      if (!b.location_query) return b;
      try {
        const [place] = await searchPlaces(b.location_query, { maxResults: 1 });
        return place ? { ...b, place } : b;
      } catch {
        return b; // geocoding is best-effort
      }
    }),
  );

  return { bookings: located };
});
