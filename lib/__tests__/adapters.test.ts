import { describe, expect, it } from "vitest";
import { pickFocalTweet, statusIdOf } from "../adapters";

// Geometry of a real x.com status page at 900px tall: the focal tweet sits under the 53px
// sticky header and the first reply starts near the viewport centre.
const focal = { id: "focal", statusId: "1966000000000000001", top: 53, height: 320, visible: true };
const reply1 = { id: "reply1", statusId: "1966000000000000002", top: 400, height: 180, visible: true };
const reply2 = { id: "reply2", statusId: "1966000000000000003", top: 600, height: 160, visible: true };
const MID = 450;

describe("pickFocalTweet", () => {
  it("status page: picks the tweet the URL names even though a reply is nearer the centre", () => {
    expect(pickFocalTweet([focal, reply1, reply2], MID, focal.statusId)?.id).toBe("focal");
  });
  it("status page, focal tweet scrolled out of view: still the focal tweet while it is mounted", () => {
    const scrolled = { ...focal, top: -1400, visible: false };
    expect(pickFocalTweet([scrolled, reply1, reply2], MID, focal.statusId)?.id).toBe("focal");
  });
  it("status page, focal tweet unmounted by virtual scrolling: nearest visible tweet", () => {
    expect(pickFocalTweet([reply1, reply2], MID, focal.statusId)?.id).toBe("reply1");
  });
  it("timeline: the tweet whose centre is nearest the viewport centre", () => {
    const a = { id: "a", statusId: "1", top: -100, height: 200, visible: true }; // centre 0
    const b = { id: "b", statusId: "2", top: 300, height: 200, visible: true }; // centre 400
    const c = { id: "c", statusId: "3", top: 700, height: 200, visible: true }; // centre 800
    expect(pickFocalTweet([a, b, c], MID, null)?.id).toBe("b");
  });
  it("timeline: off-screen tweets are never picked", () => {
    const off = { id: "off", statusId: "9", top: 5000, height: 100, visible: false };
    expect(pickFocalTweet([off], MID, null)).toBeUndefined();
  });
});

describe("statusIdOf", () => {
  it("parses relative and absolute hrefs and pathnames", () => {
    expect(statusIdOf("/nvidia/status/1966000000000000001")).toBe("1966000000000000001");
    expect(statusIdOf("https://x.com/nvidia/status/1966000000000000001/photo/1")).toBe("1966000000000000001");
    expect(statusIdOf("/nvidia")).toBeNull();
    expect(statusIdOf(undefined)).toBeNull();
  });
});
