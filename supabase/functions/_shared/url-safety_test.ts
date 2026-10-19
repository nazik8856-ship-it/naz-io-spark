// Run with: deno test supabase/functions/_shared/url-safety_test.ts
import { isPrivateOrLoopbackIp, validateOutboundUrl } from "./url-safety.ts";
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

Deno.test("private, loopback, link-local, metadata and reserved IPv4 ranges are refused", () => {
  for (const ip of ["10.0.0.1", "127.0.0.2", "0.0.0.0", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.254", "198.18.0.1", "198.19.255.255", "192.0.0.1", "224.0.0.1", "255.255.255.255", "240.0.0.1", "not.an.ip.x", "1.2.3"]) {
    assertEquals(isPrivateOrLoopbackIp(ip), true, ip);
  }
});

Deno.test("public IPv4 addresses are allowed, including the ranges next to the private ones", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "198.17.0.1", "198.20.0.1", "193.0.0.1"]) {
    assertEquals(isPrivateOrLoopbackIp(ip), false, ip);
  }
});

Deno.test("IPv6: loopback, link-local, unique-local, multicast and documentation are refused", () => {
  for (const ip of ["::1", "::", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "[::1]", "fe80::1%eth0"]) {
    assertEquals(isPrivateOrLoopbackIp(ip), true, ip);
  }
  assertEquals(isPrivateOrLoopbackIp("2606:4700:4700::1111"), false);
});

Deno.test("IPv6 that carries a private IPv4 address cannot be used to get around the IPv4 rules", () => {
  for (const ip of ["::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:c0a8:101", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "::10.0.0.1"]) {
    assertEquals(isPrivateOrLoopbackIp(ip), true, ip);
  }
  assertEquals(isPrivateOrLoopbackIp("::ffff:8.8.8.8"), false);
  assertEquals(isPrivateOrLoopbackIp("::ffff:808:808"), false);
});

Deno.test("a URL is https only, and an address written into it is judged as that address without any lookup", async () => {
  for (const [u, ok] of [
    ["http://example.com/x", false], ["ftp://example.com", false], ["", false], ["not a url", false],
    ["https://127.0.0.1/x", false], ["https://127.0.0.2/x", false], ["https://[::1]/x", false], ["https://[::ffff:10.0.0.1]/x", false], ["https://169.254.169.254/latest/meta-data", false],
    ["https://100.64.0.5/x", false], ["https://localhost/x", false], ["https://2130706433/", false], ["https://0x7f.0.0.1/", false],
    ["https://8.8.8.8/x", true],
  ] as [string, boolean][]) {
    assertEquals((await validateOutboundUrl(u)).ok, ok, u);
  }
});
