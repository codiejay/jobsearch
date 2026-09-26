// The feed mappers, against samples saved from each API on 2026-09-26.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapJobgether,
  jobgetherDesc,
  mapJobicy,
  mapArbeitnow,
  mapHimalayas,
  mapLandingjobs,
  mapAshby,
  mapGreenhouse,
  mapLever,
} from "./feeds.mjs";
import { score, region } from "./score.mjs";

const NOW = Date.parse("2026-09-26T09:00:00Z");

test("Jobgether: the pipes come off the title, Full Remote is remote", () => {
  const j = mapJobgether({
    id: "6ab623ce865119c687ed524b",
    title: "Staff Backend Engineer - Alerting | UK | Remote",
    company: "Grafana Labs",
    url: "https://jobgether.com/offer/6ab623ce865119c687ed524b-staff",
    location: "Spain, United Kingdom, Sweden, Germany, Ireland",
    remote: "Full Remote",
    salaryRange: "103958-124750 GBP",
    postedAt: "2026-09-25T07:33:34.221Z",
  });
  assert.equal(j.id, "jg:6ab623ce865119c687ed524b");
  assert.equal(j.title, "Staff Backend Engineer - Alerting");
  assert.equal(j.mode, "remote");
  assert.equal(region(j), "EU");
  assert.equal(j.postedAt, Date.parse("2026-09-25T07:33:34.221Z"));
  assert.equal(mapJobgether({ id: 1, title: "x", remote: "Hybrid", location: "Lisbon" }).mode, "on-site");
});

test("Jobgether: the offer page's JSON-LD gives the description", () => {
  const html = `<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"x","description":"<p>We build</p><ul><li>React</li></ul>"}</script>`;
  assert.equal(jobgetherDesc(html), "We build\n\n• React");
  assert.equal(jobgetherDesc("<html></html>"), "");
});

test("Jobicy: the eligible countries are the location, Portugal wins", () => {
  const j = mapJobicy({
    id: 151420,
    url: "https://jobicy.com/jobs/151420-staff-frontend-engineer-design-systems",
    jobTitle: "Staff Frontend Engineer - Design Systems",
    companyName: "Pleo",
    jobGeo: "Denmark,  Portugal,  UK",
    jobDescription: "<p>Design systems in React.</p>",
    pubDate: "2026-09-23T04:02:07+00:00",
  });
  assert.equal(j.id, "jc:151420");
  assert.equal(j.location, "Denmark, Portugal, UK");
  assert.equal(region(j), "PT");
  assert.equal(j.desc, "Design systems in React.");
  assert.equal(score(j, NOW).takeable, true);
  assert.equal(mapJobicy({ id: 1, companyName: "Zone &#038; Co", jobTitle: "x" }).company, "Zone & Co");
});

test("Arbeitnow: on-site Karlsruhe with no visa offer is not takeable; remote is", () => {
  const raw = {
    slug: "software-engineer-frontend-karlsruhe-347504",
    company_name: "Prenode",
    title: "Frontend Engineer",
    description: "<p>React and TypeScript.</p>",
    remote: false,
    url: "https://www.arbeitnow.com/jobs/companies/prenode/x",
    tags: ["React"],
    location: "Karlsruhe",
    created_at: 1790399380,
  };
  const onSite = mapArbeitnow(raw);
  assert.equal(onSite.id, "an:software-engineer-frontend-karlsruhe-347504");
  assert.equal(onSite.postedAt, 1790399380000);
  assert.equal(onSite.mode, "on-site");
  assert.equal(score(onSite, NOW).takeable, false);
  const sponsored = mapArbeitnow({ ...raw, description: "<p>We offer visa sponsorship.</p>" });
  assert.equal(score(sponsored, NOW).takeable, true);
  const remote = mapArbeitnow({ ...raw, remote: true, location: "Remote job" });
  assert.equal(remote.mode, "remote");
  assert.equal(score(remote, NOW).takeable, true);
});

test("Himalayas: no restrictions means worldwide, US-only is out", () => {
  const raw = {
    guid: "https://himalayas.app/companies/acme/jobs/frontend-engineer",
    title: "Frontend Engineer",
    companyName: "Acme",
    locationRestrictions: [],
    description: "<p>Next.js.</p>",
    excerpt: "Next.js.",
    pubDate: 1790363348,
    applicationLink: "https://himalayas.app/companies/acme/jobs/frontend-engineer",
  };
  const ww = mapHimalayas(raw);
  assert.equal(ww.location, "Worldwide");
  assert.equal(region(ww), "WW");
  assert.equal(ww.postedAt, 1790363348000);
  const us = mapHimalayas({ ...raw, locationRestrictions: ["United States"] });
  assert.equal(score(us, NOW), null);
});

test("Landing.jobs: the company comes from the URL, Lisbon is PT and takeable on-site", () => {
  const j = mapLandingjobs({
    id: 19604,
    currency_code: "EUR",
    role_description: "<p>Web platform.</p>",
    main_requirements: "<ul><li>React</li></ul>",
    title: "Staff Engineer - Web Platform (Typecript/React)",
    published_at: "2026-05-05T08:38:31.199Z",
    remote: false,
    url: "https://landing.jobs/at/dashlane-pt/staff-engineer-web-platform",
    locations: [{ city: "Lisbon", country_code: "PT" }],
  });
  assert.equal(j.id, "lj:19604");
  assert.equal(j.company, "Dashlane");
  assert.equal(j.location, "Lisbon, PT");
  assert.equal(j.mode, "on-site");
  assert.equal(j.desc, "Web platform.\n\n• React");
  assert.equal(score(j, NOW).takeable, true);
});

test("company boards: Ashby, Greenhouse and Lever map to one shape", () => {
  const c = { ats: "ashby", slug: "attio", name: "Attio" };
  const a = mapAshby(c, {
    id: "8fb5c68d",
    title: "Product Engineer",
    location: "Poland",
    secondaryLocations: [{ location: "Portugal" }],
    isRemote: true,
    jobUrl: "https://jobs.ashbyhq.com/attio/8fb5c68d",
    publishedAt: "2026-05-28T15:31:10.885+00:00",
    descriptionPlain: "Build the product in React.",
  });
  assert.equal(a.id, "co:ashby:attio:8fb5c68d");
  assert.equal(a.company, "Attio");
  assert.equal(a.location, "Poland; Portugal");
  assert.equal(a.mode, "remote");
  assert.equal(a.source, "Company board");

  const g = mapGreenhouse({ ats: "greenhouse", slug: "vercel" }, {
    id: 6136160004,
    title: "Frontend Engineer",
    location: { name: "Remote - EMEA" },
    absolute_url: "https://job-boards.greenhouse.io/vercel/jobs/6136160004",
    first_published: "2026-08-06T12:50:10-04:00",
    content: "&lt;p&gt;Next.js &amp; React.&lt;/p&gt;",
  });
  assert.equal(g.company, "Vercel");
  assert.equal(g.mode, "remote");
  assert.equal(g.desc, "Next.js & React.");
  assert.equal(region(g), "EU");

  const l = mapLever({ ats: "lever", slug: "mistral" }, {
    id: "abc",
    text: "Frontend Engineer",
    categories: { location: "Paris" },
    workplaceType: "hybrid",
    hostedUrl: "https://jobs.lever.co/mistral/abc",
    createdAt: 1790000000000,
    descriptionPlain: "TypeScript.",
  });
  assert.equal(l.id, "co:lever:mistral:abc");
  assert.equal(l.mode, "on-site");
  assert.equal(l.postedAt, 1790000000000);
});
