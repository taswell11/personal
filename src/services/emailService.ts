import { getAccessToken, clearAccessToken } from '../lib/firebase';
import { firebaseService } from './firebaseService';

export const emailService = {
  async sendEmail(to: string, subject: string, html: string) {
    if (!to || !to.includes('@')) {
      console.warn('Cannot send email: Invalid recipient address', to);
      await firebaseService.logEmail(to || 'unknown', subject, html, 'failed', 'Invalid or empty email address.');
      return false;
    }

    const accessToken = getAccessToken();
    
    if (!accessToken) {
      console.warn('Cannot send email: No Gmail access token');
      await firebaseService.logEmail(to, subject, html, 'failed', 'No Gmail access token - Please connect your Gmail account from the dashboard profile settings.');
      return false;
    }

    try {
      const response = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ to, subject, html }),
      });
      
      const result = await response.json();
      if (result.success) {
        await firebaseService.logEmail(to, subject, html, 'sent');
        return true;
      }
      
      console.error('Gmail API failed:', result.error || result.details);
      
      const isAuthError = response.status === 401 || response.status === 403 || 
        (typeof result.details === 'string' && (
          result.details.toLowerCase().includes('credential') || 
          result.details.toLowerCase().includes('token') || 
          result.details.toLowerCase().includes('auth') || 
          result.details.toLowerCase().includes('unauthorized')
        ));
      
      if (isAuthError) {
        clearAccessToken();
      }

      const errMsg = isAuthError 
        ? 'Gmail session expired or invalid credentials. Please disconnect and reconnect your Gmail account from settings.'
        : (result.details || result.error || 'Gmail API failed to deliver the message.');

      await firebaseService.logEmail(to, subject, html, 'failed', typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
      return false;
    } catch (err: any) {
      console.error('Gmail API service error:', err);
      await firebaseService.logEmail(to, subject, html, 'failed', err?.message || 'Network error connecting to Gmail API proxy.');
      return false;
    }
  },

  async sendInvitation(email: string, creditorName: string, inviteLink: string) {
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #334155;">
        <h1 style="color: #4f46e5;">Welcome to CreditSync</h1>
        <p>Hello,</p>
        <p><strong>${creditorName}</strong> has invited you to join their credit network on CreditSync.</p>
        <div style="margin: 30px 0;">
          <a href="${inviteLink}" style="background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
            Join Now
          </a>
        </div>
        <p>If you have any questions, please contact your creditor directly.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">This is an automated message from CreditSync.</p>
      </div>
    `;
    return this.sendEmail(email, `Invitation to join CreditSync from ${creditorName}`, html);
  },

  async sendCreditIssued(email: string, creditorName: string, amount: number, interest: number) {
    const total = amount + interest;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #334155;">
        <h1 style="color: #4f46e5;">Credit Issued</h1>
        <p>Hello,</p>
        <p>A new credit has been issued to your account by <strong>${creditorName}</strong>.</p>
        <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b;">Amount Issued</p>
          <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: 900; color: #0f172a;">R ${amount.toLocaleString()}</p>
          
          <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b;">Interest Added</p>
          <p style="margin: 0 0 10px 0; font-size: 18px; font-weight: 700; color: #475569;">R ${interest.toLocaleString()}</p>
          
          <div style="border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 10px;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #4f46e5; font-weight: bold;">Total Owed</p>
            <p style="margin: 0; font-size: 28px; font-weight: 900; color: #4f46e5;">R ${total.toLocaleString()}</p>
          </div>
        </div>
        <p>You can view your account details by <a href="https://creditsync-863590140061.us-west1.run.app" style="color: #4f46e5; font-weight: bold; text-decoration: underline;">logging into CreditSync</a>.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">This is an automated message from CreditSync.</p>
      </div>
    `;
    return this.sendEmail(email, `Credit Confirmation: R${total.toLocaleString()}`, html);
  },

  async sendPaymentReminder(email: string, borrowerName: string, amount: number) {
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #334155;">
        <h1 style="color: #4f46e5;">Payment Reminder</h1>
        <p>Hello ${borrowerName},</p>
        <p>This is a friendly reminder that you have an upcoming payment due.</p>
        <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b;">Amount Due</p>
          <p style="margin: 0 0 10px 0; font-size: 28px; font-weight: 900; color: #0f172a;">R ${amount.toLocaleString()}</p>
        </div>
        <p>Please ensure your payment is made on time to keep your account in good standing.</p>
        <p>You can view your account details by <a href="https://creditsync-863590140061.us-west1.run.app" style="color: #4f46e5; font-weight: bold; text-decoration: underline;">logging into CreditSync</a>.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">This is an automated message from CreditSync.</p>
      </div>
    `;
    return this.sendEmail(email, `Payment Reminder: R${amount.toLocaleString()}`, html);
  },
  async sendPaymentRecorded(email: string, borrowerName: string, amount: number, creditorName: string) {
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #334155;">
        <h1 style="color: #10b981;">Payment Received</h1>
        <p>Hello ${borrowerName},</p>
        <p>Your payment has been successfully recorded by <strong>${creditorName}</strong>.</p>
        <div style="background: #ecfdf5; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #d1fae5;">
          <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #059669;">Amount Paid</p>
          <p style="margin: 0; font-size: 28px; font-weight: 900; color: #047857;">R ${amount.toLocaleString()}</p>
        </div>
        <p>You can view your updated portfolio and transaction history by <a href="https://creditsync-863590140061.us-west1.run.app" style="color: #4f46e5; font-weight: bold; text-decoration: underline;">logging into CreditSync</a>.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">This is an automated message from CreditSync.</p>
      </div>
    `;
    return this.sendEmail(email, `Payment Confirmation: R${amount.toLocaleString()}`, html);
  },

  async sendLoanRequest(creditorEmail: string, borrowerName: string, amount: number) {
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #334155;">
        <h1 style="color: #4f46e5;">New Loan Request</h1>
        <p>Hello,</p>
        <p><strong>${borrowerName}</strong> has submitted a new loan request for <strong>R ${amount.toLocaleString()}</strong>.</p>
        <p>Please <a href="https://creditsync-863590140061.us-west1.run.app" style="color: #4f46e5; font-weight: bold; text-decoration: underline;">log in to your dashboard</a> to review and approve this request.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">This is an automated message from CreditSync.</p>
      </div>
    `;
    return this.sendEmail(creditorEmail, `New Loan Request from ${borrowerName}`, html);
  },

  async sendRequestCancelled(creditorEmail: string, borrowerName: string, amount: number) {
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #334155;">
        <h1 style="color: #f59e0b;">Loan Request Cancelled</h1>
        <p>Hello,</p>
        <p><strong>${borrowerName}</strong> has cancelled their loan request for <strong>R ${amount.toLocaleString()}</strong>.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">This is an automated message from CreditSync.</p>
      </div>
    `;
    return this.sendEmail(creditorEmail, `Loan Request Cancelled by ${borrowerName}`, html);
  },

  async sendRequestRejected(borrowerEmail: string, creditorName: string, amount: number) {
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #334155;">
        <h1 style="color: #ef4444;">Loan Request Update</h1>
        <p>Hello,</p>
        <p>Your loan request for <strong>R ${amount.toLocaleString()}</strong> has been declined by <strong>${creditorName}</strong>.</p>
        <p>Please contact your creditor if you have any questions.</p>
        <p>You can view your account details by <a href="https://creditsync-863590140061.us-west1.run.app" style="color: #4f46e5; font-weight: bold; text-decoration: underline;">logging into CreditSync</a>.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">This is an automated message from CreditSync.</p>
      </div>
    `;
    return this.sendEmail(borrowerEmail, `Loan Request Declined`, html);
  }
};
