import {
  createDNSRecord,
  listDNSRecords,
  listZones,
  updateDNSRecords
} from "@cloudflare-ddns/api";
import _ from "lodash";
import { Domain, isZoneIdDomain } from "@cloudflare-ddns/config";

import { Context } from "./context";
import { CloudflareApiError, CloudflareError, wrapError } from "./error";

interface Record {
  domain: Domain;
  ip: string;
}

const getZoneId = async (ctx: Context, record: Record): Promise<string> => {
  const { domain } = record;
  if (isZoneIdDomain(domain)) {
    return domain.zoneId;
  }
  const { auth, api: baseURL } = ctx.config;
  const { zoneName: name } = domain;
  try {
    const res = await listZones({
      auth,
      params: { name },
      baseURL
    });
    const { success, errors, result } = res.data;
    if (!success || !result) {
      throw new CloudflareApiError(errors);
    }
    const zoneId = _.first(result)?.id;
    if (!zoneId) {
      throw new CloudflareError("No match zone found");
    }
    return zoneId;
  } catch (e) {
    throw wrapError(e);
  }
};

interface DNSRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

const getDNSRecord = async (
  ctx: Context,
  record: Record,
  zoneId: string
): Promise<DNSRecord | undefined> => {
  const { auth, api: baseURL } = ctx.config;
  const { name, type } = record.domain;
  try {
    const res = await listDNSRecords({
      auth,
      params: { name, type },
      zoneId,
      baseURL
    });
    const { success, errors, result } = res.data;
    if (!success || !result) {
      throw new CloudflareApiError(errors);
    }
    return _.first(result);
  } catch (e) {
    throw wrapError(e);
  }
};

const update = async (
  ctx: Context,
  record: Record,
  zoneId: string,
  dnsRecord: DNSRecord
): Promise<DNSRecord> => {
  const { auth, api: baseURL } = ctx.config;
  const { name, type, proxied } = record.domain;
  const { ttl, id: recordId } = dnsRecord;
  try {
    const res = await updateDNSRecords({
      auth,
      data: { content: record.ip, name, type, proxied, ttl },
      zoneId,
      recordId,
      baseURL
    });
    const { success, errors, result } = res.data;
    if (!success || !result) {
      throw new CloudflareApiError(errors);
    }
    return result;
  } catch (e) {
    throw wrapError(e);
  }
};

const create = async (
  ctx: Context,
  record: Record,
  zoneId: string
): Promise<DNSRecord> => {
  const { auth, api: baseURL } = ctx.config;
  const { name, type, proxied } = record.domain;
  try {
    const res = await createDNSRecord({
      auth,
      data: { content: record.ip, name, type, proxied, ttl: 1 },
      zoneId,
      baseURL
    });
    const { success, errors, result } = res.data;
    if (!success || !result) {
      throw new CloudflareApiError(errors);
    }
    return result;
  } catch (e) {
    throw wrapError(e);
  }
};

const updateOrCreate = async (
  ctx: Context,
  record: Record,
  zoneId: string,
  dnsRecord?: DNSRecord
): Promise<DNSRecord | undefined> => {
  const { logger } = ctx;
  const { ip, domain } = record;
  if (dnsRecord) {
    const { content } = dnsRecord;
    if (ip === content) {
      logger.info("Skipped updating.", { domain: domain.name });
    } else {
      logger.info("Started updating.", { domain: domain.name });
      return await update(ctx, record, zoneId, dnsRecord);
    }
  } else if (domain.create) {
    logger.info("Started creating.", { domain: domain.name });
    return await create(ctx, record, zoneId);
  } else {
    logger.info("Skipped creating.", { domain: domain.name });
  }
  return undefined;
};

export const updateDns = async (
  ctx: Context,
  record: Record
): Promise<DNSRecord | undefined> => {
  const zoneId = await getZoneId(ctx, record);
  const dnsRecord = await getDNSRecord(ctx, record, zoneId);
  return updateOrCreate(ctx, record, zoneId, dnsRecord);
};
