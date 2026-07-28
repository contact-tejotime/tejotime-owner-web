import { many } from '../../db/pool';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';
import { businessDayRange, dayjs } from '../../lib/time';

/**
 * "Request access" leads from the public marketing site. Platform-wide, not tied to any
 * business — uses env.DEFAULT_TIMEZONE like other platform-wide admin reads.
 */

const LIST_LIMIT = 500;

export async function listInquiries(from: string | undefined, to: string | undefined) {
  const tz = env.DEFAULT_TIMEZONE;
  const toDate = to ?? dayjs().tz(tz).format('YYYY-MM-DD');
  const fromDate = from ?? dayjs.tz(toDate, tz).subtract(6, 'day').format('YYYY-MM-DD');
  const spanDays = dayjs(toDate).diff(dayjs(fromDate), 'day');
  if (spanDays < 0) throw Errors.validation('`from` must be on or before `to`');
  if (spanDays > 366) throw Errors.validation('Date range too large (max 366 days)');

  const startIso = businessDayRange(tz, fromDate).startIso;
  const endIso = businessDayRange(tz, toDate).endIso;

  const rows = await many(
    `select * from inquiry
      where created_at >= $1 and created_at <= $2
      order by created_at desc
      limit ${LIST_LIMIT}`,
    [startIso, endIso],
  );

  return {
    from: fromDate,
    to: toDate,
    data: rows.map((r) => ({
      id: r.id,
      businessName: r.business_name,
      address: r.address,
      phone: r.phone,
      submittedAt: r.created_at,
    })),
    meta: { shown: rows.length, total: rows.length, limit: LIST_LIMIT },
  };
}
