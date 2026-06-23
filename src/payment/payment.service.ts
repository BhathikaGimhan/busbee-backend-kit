import { Injectable, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

export interface PayHereCheckoutPayload {
  sandbox: boolean;
  merchant_id: string;
  return_url: undefined;
  cancel_url: undefined;
  notify_url: string;
  order_id: string;
  items: string;
  amount: string;
  currency: string;
  hash: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
}

export interface PayHereNotifyPayload {
  merchant_id?: string;
  order_id?: string;
  payment_id?: string;
  payhere_amount?: string;
  payhere_currency?: string;
  status_code?: string;
  md5sig?: string;
  method?: string;
  status_message?: string;
}

/**
 * PayHere sandbox integration (gateway plumbing only).
 *
 * Local notify_url setup:
 * 1. Create a sandbox account at https://sandbox.payhere.lk
 * 2. Add domain "localhost" under Integrations -> Add Domain/App
 * 3. Copy PAYHERE_MERCHANT_ID and PAYHERE_MERCHANT_SECRET into .env
 * 4. Run the backend, then: ngrok http 3000
 * 5. Set PAYHERE_NOTIFY_URL=https://<ngrok-id>.ngrok-free.app/payment/notify
 */
@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const { merchantId, merchantSecret, notifyUrl } = this.getPayHereSettings();
    if (!merchantId || !merchantSecret || !notifyUrl) {
      const missing = [
        !merchantId && 'PAYHERE_MERCHANT_ID',
        !merchantSecret && 'PAYHERE_MERCHANT_SECRET',
        !notifyUrl && 'PAYHERE_NOTIFY_URL',
      ].filter(Boolean);
      this.logger.warn(
        `PayHere is not fully configured. Missing: ${missing.join(', ')}. Restart the server after updating .env.`,
      );
    } else {
      this.logger.log(`PayHere configured (sandbox=${this.isSandbox()}, notify=${notifyUrl})`);
    }
  }

  private readEnv(key: string): string | undefined {
    const value = this.configService.get<string>(key) ?? process.env[key];
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  private resolveNotifyUrl(raw?: string): string | undefined {
    if (!raw) return undefined;

    let url = raw.trim().replace(/\/$/, '');

    // Common copy/paste truncation from ngrok UI
    if (url.endsWith('.ngrok-free.a')) {
      url = `${url}pp`;
    }

    if (!url.endsWith('/payment/notify')) {
      url = `${url}/payment/notify`;
    }

    return url;
  }

  private isSandbox(): boolean {
    return this.readEnv('PAYHERE_SANDBOX') !== 'false';
  }

  private getPayHereSettings() {
    const merchantId = this.readEnv('PAYHERE_MERCHANT_ID');
    const merchantSecret = this.readEnv('PAYHERE_MERCHANT_SECRET');
    const notifyUrl = this.resolveNotifyUrl(this.readEnv('PAYHERE_NOTIFY_URL'));

    return { merchantId, merchantSecret, notifyUrl };
  }

  formatAmount(amount: number): string {
    return parseFloat(String(amount)).toFixed(2);
  }

  generateCheckoutHash(
    merchantId: string,
    orderId: string,
    amount: number,
    currency: string,
    merchantSecret: string,
  ): string {
    const hashedSecret = createHash('md5')
      .update(merchantSecret)
      .digest('hex')
      .toUpperCase();
    const amountFormatted = this.formatAmount(amount);

    return createHash('md5')
      .update(merchantId + orderId + amountFormatted + currency + hashedSecret)
      .digest('hex')
      .toUpperCase();
  }

  verifyNotificationSignature(
    payload: PayHereNotifyPayload,
    merchantSecret: string,
  ): boolean {
    const {
      merchant_id,
      order_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig,
    } = payload;

    if (
      !merchant_id ||
      !order_id ||
      !payhere_amount ||
      !payhere_currency ||
      !status_code ||
      !md5sig
    ) {
      return false;
    }

    const hashedSecret = createHash('md5')
      .update(merchantSecret)
      .digest('hex')
      .toUpperCase();

    const localSig = createHash('md5')
      .update(
        merchant_id +
          order_id +
          payhere_amount +
          payhere_currency +
          status_code +
          hashedSecret,
      )
      .digest('hex')
      .toUpperCase();

    return localSig === md5sig.toUpperCase();
  }

  private generateOrderId(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = randomBytes(4).toString('hex');
    return `BB-${date}-${suffix}`;
  }

  private splitCustomerName(displayName: string): {
    first_name: string;
    last_name: string;
  } {
    const trimmed = displayName.trim() || 'Passenger';
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return { first_name: parts[0], last_name: 'User' };
    }
    return {
      first_name: parts[0],
      last_name: parts.slice(1).join(' '),
    };
  }

  createCheckoutPayload(
    dto: CreateCheckoutDto,
    customerEmail: string,
    customerName: string,
  ): PayHereCheckoutPayload {
    const { merchantId, merchantSecret, notifyUrl } = this.getPayHereSettings();
    const sandbox = this.isSandbox();

    if (!merchantId || !merchantSecret || !notifyUrl) {
      const missing = [
        !merchantId && 'PAYHERE_MERCHANT_ID',
        !merchantSecret && 'PAYHERE_MERCHANT_SECRET',
        !notifyUrl && 'PAYHERE_NOTIFY_URL',
      ].filter(Boolean);
      throw new BadRequestException(
        `PayHere is not configured. Missing: ${missing.join(', ')}. Update busbee-backend-kit/.env and restart the backend server.`,
      );
    }

    const currency = 'LKR';
    const orderId = this.generateOrderId();
    const amountFormatted = this.formatAmount(dto.amount);
    const hash = this.generateCheckoutHash(
      merchantId,
      orderId,
      dto.amount,
      currency,
      merchantSecret,
    );
    const { first_name, last_name } = this.splitCustomerName(customerName);

    return {
      sandbox,
      merchant_id: merchantId,
      return_url: undefined,
      cancel_url: undefined,
      notify_url: notifyUrl,
      order_id: orderId,
      items: dto.items,
      amount: amountFormatted,
      currency,
      hash,
      first_name,
      last_name,
      email: customerEmail,
      phone: '0770000000',
      address: 'N/A',
      city: 'Colombo',
      country: 'Sri Lanka',
    };
  }

  handleNotification(payload: PayHereNotifyPayload): void {
    const { merchantSecret } = this.getPayHereSettings();

    if (!merchantSecret) {
      this.logger.error('PayHere merchant secret is not configured');
      throw new BadRequestException('PayHere is not configured');
    }

    const isValid = this.verifyNotificationSignature(payload, merchantSecret);
    if (!isValid) {
      this.logger.warn(
        `Invalid PayHere notification signature for order ${payload.order_id}`,
      );
      throw new BadRequestException('Invalid notification signature');
    }

    this.logger.log(
      `PayHere notification verified: order=${payload.order_id}, status=${payload.status_code}, payment_id=${payload.payment_id}`,
    );
  }
}
