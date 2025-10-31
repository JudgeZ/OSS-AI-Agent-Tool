import { describe, it, expect, vi, afterEach } from "vitest";

import type { SecretsStore } from "../auth/SecretsStore.js";
import { GoogleProvider } from "./google.js";

class MockSecretsStore implements SecretsStore {
  constructor(private readonly values: Record<string, string> = {}) {}

  async get(key: string): Promise<string | undefined> {
    return this.values[key];
  }

  async set(key: string, value: string): Promise<void> {
    this.values[key] = value;
  }

  async delete(key: string): Promise<void> {
    delete this.values[key];
  }
}

describe("GoogleProvider", () => {
  const fixedNow = 1_700_000_000_000;
  const now = () => fixedNow;

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_SERVICE_ACCOUNT;
  });

  it("prefers stored OAuth access tokens when available", async () => {
    const secrets = new MockSecretsStore({
      "oauth:google:tokens": JSON.stringify({
        access_token: "ya29.token",
        expires_at: fixedNow + 3600_000
      }),
      "oauth:google:access_token": "ya29.token"
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "hello" }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }
      })
    });

    const provider = new GoogleProvider(secrets, { fetch: fetchMock as typeof fetch, now });
    const response = await provider.chat({ messages: [{ role: "user", content: "hi" }] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer ya29.token" });
    expect(response.output).toBe("hello");
    expect(response.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
  });

  it("falls back to service account credentials when OAuth tokens are absent", async () => {
    const serviceAccount = JSON.stringify({
      client_email: "svc@example.iam.gserviceaccount.com",
      private_key: `-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCjIb1RT3cZ+JVR\nMS9JFZOwTHGcXFjW4ZneP94ACZcVLO8W5iKTFkyT0XxyuPsifBArIGhA4wmdKXvj\nc+8vYVvKU6STGHnYfBl6X67/akpW65Yibp0VkQaxlqEdONRcSX1xf3qg9NI3Ehlh\nYqgBbZNsvs8+3BwFma64VMRGXsoIb/NTYAWHin1BFz91FjPKcl3KnFbzt2dMYgpn\nzqw78sf09tYRg2U4/vyBQ9rHlmpGI56S+ajOE3+lXhO/zVCr1Os3bnhVLMwiE21C\nyUKbJjK/BuvfA0QmqECYfqdD2G4IWOyiI+MgRo0M6J0exCd9KHeb/8NgBwJXDtwP\naX2yQO51AgMBAAECggEAAn7RIQ3Ioh6R1iic8w6/8BnzQPOOrlbMHkC22iRLadkC\nnUSO8dYM/NPfBfg7azcfnjFENv3iF0Pbr8qFtaFVIJ6v7UoaDwwy7ZLKIAEVuwem\nh8dOYtaRliTaORK1+OVs5FARZaXpE0uVFM7ICCGPeEHg9LK0QQetSweM6xCnIYLi\nm7gPWV1X/01fGzz40QTMReBUkB/AZFcyUdCDWFxFCizpsQxuy0v9yKts7rd+VM3r\njNfWyWBaEaWQktMmlQMi3WvMsMTVYFUx+vNY82x21uwj+uahD7qYFGcjHgClWOnM\n4fRMRkmanwsGevSY3wgvNoo5AtWfst/B2JoMe7b8AQKBgQDguyzPotDZvIdTTP0E\noy6zmTTdjmCpJnGnveAZxM7cZsNs8lHKckDcaYG2lFpBoO0N4WDloXWXyznxIcfI\n1zzsDHtk6Q/842ZiWXatieLKBlHqlv85mKJOOxUaKXC70KS43SSUDBAfR7jGH4Ec\nDXGwKvSi85mSi+Ku6ErCHtY+AQKBgQC51GwjhtSdWhP3v2FPVNEwNpzcO4HEYYsX\n97t1g5+rFzbkV/repNWZF9Ujx9/VUki7p6p6FfthyaLdsqYMk60YbxbMSWCSK8LL\nzMQdndyPDgC+nxDyVOkDF4P52fycPct+A8Un2++3iD7mc48vyt0l/unJ+BNpyw5e\n203z8YaYdQKBgQCL0gjsWsmEXvb3TfQyGXEqDs1Ed5wOQbv++HTgs4FcwZcfRpi6\n02ElgYNR3HVXVc+Hjk0iMdWfDrNLIpBRlhDycEWpoBPxbG48DJt5F0wCE/KNeUrs\nQ9nfwIS9lUDtqb+CwRxL/EFfpNkCc4F5uaedSuyQIe3PrrbnyeERa+wyAQKBgQCI\namYQFnSSJoQuBPH8eLkv+YdhLNXwQeMH7zZP6BYYVOxY6DUjqEGdJx+yKpIoWUVH\nbKf7A5QMjybeNL0s0mPpYfOMd/lKlJFlZqY5T5+P7KmjRcX8/1Qmjua1Tc7hK4Ps\nt/vNbOknA/+Y0RA192gs8lrRhylJKmUcQUWSZKV32QKBgQC7AQBZ9o8wpX2vPVdm\nfHEtsoA1szIOjfCRgRczR8SZa7r27zxEmmahrC7eldjknkG8HJsgk6dk6BeRY3fp\nCS/6Q3g6Ne39lyh4PVDtrx5z8gZ/5eulIOWArrAhv/YTwamkoFAHYD3LzBr7Y2kQ\nw0azo2P+61nTfxzxPeQzIX55PA==\n-----END PRIVATE KEY-----\n`
    });

    const secrets = new MockSecretsStore({ "provider:google:serviceAccount": serviceAccount });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "svc-token", expires_in: 3600 })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "svc" }] } }] })
      };
    });

    const provider = new GoogleProvider(secrets, { fetch: fetchMock as typeof fetch, now });
    const response = await provider.chat({ messages: [{ role: "user", content: "ping" }] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, generativeInit] = fetchMock.mock.calls[1];
    expect(generativeInit?.headers).toMatchObject({ Authorization: "Bearer svc-token" });
    expect(response.output).toBe("svc");
  });

  it("falls back to the configured API key when neither OAuth nor service accounts are present", async () => {
    const secrets = new MockSecretsStore({ "provider:google:apiKey": "test-api-key" });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "api" }] } }] })
    });

    const provider = new GoogleProvider(secrets, { fetch: fetchMock as typeof fetch, now });
    const response = await provider.chat({ messages: [{ role: "user", content: "ping" }] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("key=test-api-key");
    expect(response.output).toBe("api");
  });

  it("refreshes expired OAuth tokens when a refresh token is available", async () => {
    const secrets = new MockSecretsStore({
      "oauth:google:tokens": JSON.stringify({
        access_token: "expired-token",
        refresh_token: "refresh-token",
        expires_at: fixedNow - 10
      }),
      "provider:google:oauthClientId": "client-id",
      "provider:google:oauthClientSecret": "client-secret"
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        const body = init?.body instanceof URLSearchParams ? init.body : undefined;
        expect(body?.get("grant_type")).toBe("refresh_token");
        expect(body?.get("refresh_token")).toBe("refresh-token");
        expect(body?.get("client_id")).toBe("client-id");
        expect(body?.get("client_secret")).toBe("client-secret");
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "fresh-token", expires_in: 3600 })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "refreshed" }] } }] })
      };
    });

    const provider = new GoogleProvider(secrets, { fetch: fetchMock as typeof fetch, now });
    const response = await provider.chat({ messages: [{ role: "user", content: "ping" }] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, generativeInit] = fetchMock.mock.calls[1];
    expect(generativeInit?.headers).toMatchObject({ Authorization: "Bearer fresh-token" });
    expect(await secrets.get("oauth:google:access_token")).toBe("fresh-token");
    expect(response.output).toBe("refreshed");
  });
});
