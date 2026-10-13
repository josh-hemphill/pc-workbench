export interface RelatedRecord {
  kind: "pc" | "stock" | "configuration" | "location" | "component";
  id: string;
}
