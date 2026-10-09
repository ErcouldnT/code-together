declare module "geoip-country" {
  interface Lookup {
    /** ISO 3166-1 alpha-2 */
    country: string;
  }
  const geoip: { lookup(ip: string): Lookup | null };
  export default geoip;
}
