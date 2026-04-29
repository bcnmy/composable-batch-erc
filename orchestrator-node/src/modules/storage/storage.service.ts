import { SafeJSON } from "@/common";
import { RedisService } from "@/core/redis";
import { type QuoteEntity } from "@/quotes";
import { type UserOpEntityCustomFields } from "@/user-ops";
import { isArray, mapValues } from "remeda";
import { Service } from "typedi";
import { type Hex } from "viem";
import { buildRedisKey, decodeUserOpEntity } from "./utils";

@Service()
export class StorageService {
  constructor(private readonly redisService: RedisService) {}

  async hasUserOp(hash: Hex) {
    const res = await this.redis.exists(buildRedisKey("user-op", hash, "data"));

    return !!res;
  }

  async hasQuote(hash: Hex) {
    const res = await this.redis.exists(buildRedisKey("quote", hash, "data"));

    return !!res;
  }

  async getQuote(hash: Hex) {
    let res = await this.redis
      .multi()
      .get(buildRedisKey("quote", hash, "data"))
      .lrange(buildRedisKey("quote", hash, "user-ops"), 0, -1)
      .exec();

    if (!res) {
      return null;
    }

    const rawData = res.at(0)?.at(1);
    const userOpHashes = res.at(1)?.at(1) as Hex[] | undefined;

    if (!rawData || !isArray(userOpHashes)) {
      return null;
    }

    const quote = SafeJSON.parse<QuoteEntity>(rawData as string);

    quote.userOps = [];

    let multi = this.redis.multi();

    for (const hash of userOpHashes) {
      multi = multi
        .get(buildRedisKey("user-op", hash, "data"))
        .hgetall(buildRedisKey("user-op", hash, "custom-fields"));
    }

    res = await multi.exec();

    if (!res) {
      return null; // should never happen
    }

    for (let index = 0; index < res.length; index += 2) {
      const userOp = decodeUserOpEntity(
        res.at(index)?.at(1),
        res.at(index + 1)?.at(1),
      );

      if (!userOp) {
        continue; // should never happen
      }

      quote.userOps.push(userOp);
    }

    return quote;
  }

  async createQuote(
    quote: QuoteEntity,
    options: {
      ttl?: number;
    } = {},
  ) {
    const { ttl } = options;
    const { hash } = quote;
    const { userOps, ...data } = quote;

    if (!userOps.length) {
      return false; // should never happen
    }

    const quoteKey = buildRedisKey("quote", hash, "data");

    let multi = this.redis.multi().set(quoteKey, SafeJSON.stringify(data));

    if (ttl) {
      multi = multi.expire(quoteKey, ttl);
    }

    const userOpHashes: Hex[] = [];

    for (const userOp of userOps) {
      const { meeUserOpHash } = userOp;

      userOpHashes.push(meeUserOpHash);

      const userOpKey = buildRedisKey("user-op", meeUserOpHash, "data");

      multi = multi.set(userOpKey, SafeJSON.stringify(userOp));

      if (ttl) {
        multi = multi.expire(userOpKey, ttl);
      }
    }

    const quoteUserOpKey = buildRedisKey("quote", hash, "user-ops");

    multi = multi.rpush(quoteUserOpKey, ...userOpHashes);

    if (ttl) {
      multi = multi.expire(quoteUserOpKey, ttl);
    }

    const res = await multi.exec();

    return !!res?.every(([err, res]) => !err && !!res); // should always be true
  }

  async getUserOp(hash: Hex) {
    const res = await this.redis
      .multi()
      .get(buildRedisKey("user-op", hash, "data"))
      .hgetall(buildRedisKey("user-op", hash, "custom-fields"))
      .exec();

    if (!res) {
      return null;
    }

    return decodeUserOpEntity(res.at(0)?.at(1), res.at(1)?.at(1));
  }

  async createUserOpCustomField<Name extends keyof UserOpEntityCustomFields>(
    hash: Hex,
    name: Name,
    value: Exclude<UserOpEntityCustomFields[Name], undefined>,
    options: {
      ttl?: number;
    } = {},
  ) {
    const { ttl } = options;

    const key = buildRedisKey("user-op", hash, "custom-fields");

    let multi = await this.redis
      .multi()
      .hsetnx(key, name, SafeJSON.stringify(value));

    if (ttl) {
      multi = multi.expire(key, ttl);
    }

    const res = await multi.exec();

    return !!res?.every(([err, res]) => !err && !!res); // should always be true
  }

  async setUserOpCustomField<Name extends keyof UserOpEntityCustomFields>(
    hash: Hex,
    name: Name,
    value: Exclude<UserOpEntityCustomFields[Name], undefined>,
    options: {
      ttl?: number;
    } = {},
  ) {
    const { ttl } = options;
    const key = buildRedisKey("user-op", hash, "custom-fields");

    const raw = SafeJSON.stringify(value);

    let multi = await this.redis.multi().hsetnx(key, name, raw).hget(key, name);

    if (ttl) {
      multi = multi.expire(key, ttl);
    }

    const res = await multi.exec();

    if (!res) {
      return false;
    }

    const rawSet = res.at(1)?.at(1) as string | undefined;

    return raw === rawSet;
  }

  async unsetUserOpCustomField<Name extends keyof UserOpEntityCustomFields>(
    hash: Hex,
    name: Name,
  ) {
    const key = buildRedisKey("user-op", hash, "custom-fields");

    const res = await this.redis.multi().hdel(key, name).exec();

    if (!res) {
      return false;
    }

    const isFieldUnset = res.at(0)?.at(1) === 1;

    return isFieldUnset;
  }

  async updateUserOpCustomFields(
    hash: Hex,
    customFields: UserOpEntityCustomFields,
    options: {
      ttl?: number;
    } = {},
  ) {
    const { ttl } = options;

    const key = buildRedisKey("user-op", hash, "custom-fields");

    let multi = await this.redis.multi().hset(
      key,
      mapValues(customFields, (value) => SafeJSON.stringify(value)),
    );

    if (ttl) {
      multi = multi.expire(key, ttl);
    }

    const res = await multi.exec();

    return !!res?.every(([err, res]) => !err && !!res); // should always be true
  }

  private get redis() {
    return this.redisService.getClient({
      name: "storage",
    });
  }

  async getCache<T extends object>(key: string) {
    try {
      const preparedKey = buildRedisKey("cache", key);

      const res = await this.redis.get(preparedKey);

      if (!res) {
        return null;
      }

      return SafeJSON.parse<T>(res);
    } catch (err) {
      return null;
    }
  }

  async setCache<T extends object>(
    key: string,
    data: T,
    options: {
      ttl?: number;
    } = {},
  ) {
    try {
      const { ttl } = options;

      const preparedKey = buildRedisKey("cache", key);

      let multi = this.redis.multi().set(preparedKey, SafeJSON.stringify(data));

      if (ttl) {
        multi = multi.expire(preparedKey, ttl);
      }

      const res = await multi.exec();

      return !!res?.every(([err, res]) => !err && !!res); // should always be true
    } catch (err) {
      return false;
    }
  }
}
