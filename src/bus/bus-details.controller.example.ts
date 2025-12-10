/**
 * Example Backend Controller for Bus Details
 * 
 * This shows how to implement the /bus/details endpoint
 * in your NestJS backend to handle the form submission
 */

import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  UnauthorizedException,
  Headers,
  Inject,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FirebaseService } from '../firebase/firebase.service';
import * as admin from 'firebase-admin';

// DTO for bus details submission
export class SubmitBusDetailsDto {
  registrationNumber: string;
  ntcPermitNumber: string;
  permitExpiryDate: string;
  ownerName: string;
  ownerContactNumber: string;
  busModel: string;
  serviceType: 'normal' | 'semi-luxury' | 'luxury' | 'super-luxury';
  hasAC: boolean;
  totalSeats: number;
  seatLayout: '2x2' | '2x3' | '1x2';
  amenities: {
    wifi: boolean;
    mobileCharging: boolean;
    adjustableSeats: boolean;
    tvAudioSystem: boolean;
    luggageSpace: boolean;
    curtains: boolean;
  };
}

@Controller('bus')
export class BusDetailsController {
  constructor(
    @Inject(FirebaseService) private firebaseService: FirebaseService,
  ) {}

  /**
   * Submit Bus Details Form
   * POST /bus/details
   * 
   * Handles multi-part form data with file uploads
   * Creates a new bus document with PENDING_REVIEW status
   */
  @Post('details')
  @UseInterceptors(
    FilesInterceptor('files', 4, {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
      fileFilter: (req, file, cb) => {
        // Validate file types
        const allowedMimeTypes = [
          'image/jpeg',
          'image/png',
          'application/pdf',
        ];
        
        if (allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Invalid file type'), false);
        }
      },
    }),
  )
  async submitBusDetails(
    @Body() busDetailsData: SubmitBusDetailsDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Headers('authorization') authHeader: string,
  ) {
    try {
      // 1. Extract and verify user from auth header
      const userId = await this.extractUserIdFromToken(authHeader);
      if (!userId) {
        throw new UnauthorizedException('Invalid or missing token');
      }

      // 2. Validate bus data
      this.validateBusDetails(busDetailsData);

      // 3. Check for duplicate registration number
      const existingBus = await this.checkExistingBus(busDetailsData.registrationNumber);
      if (existingBus) {
        throw new BadRequestException(
          'Bus with this registration number already exists',
        );
      }

      // 4. Upload files to Cloud Storage
      const documentUrls = await this.uploadFilesToStorage(
        files,
        userId,
      );

      // 5. Check permit document is provided
      if (!documentUrls.permitDocument) {
        throw new BadRequestException(
          'Permit document is required for approval',
        );
      }

      // 6. Create bus document in Firestore
      const busDocument = await this.createBusDocument(
        userId,
        busDetailsData,
        documentUrls,
      );

      // 7. Send admin notification
      await this.notifyAdminsOfNewBusRegistration(busDocument.id, busDetailsData);

      // 8. Send confirmation to driver
      await this.sendConfirmationToDriver(userId, busDetailsData);

      return {
        success: true,
        message: 'Bus details submitted successfully. Pending admin approval.',
        busId: busDocument.id,
        status: 'PENDING_REVIEW',
      };
    } catch (error) {
      console.error('Error submitting bus details:', error);
      throw error;
    }
  }

  /**
   * Extract User ID from JWT Token
   */
  private async extractUserIdFromToken(authHeader: string): Promise<string | null> {
    try {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }

      const token = authHeader.substring(7);
      const decodedToken = await admin.auth().verifyIdToken(token);
      return decodedToken.uid;
    } catch (error) {
      console.error('Token verification failed:', error);
      return null;
    }
  }

  /**
   * Validate Bus Details
   */
  private validateBusDetails(data: SubmitBusDetailsDto) {
    const errors: string[] = [];

    // Check required fields
    if (!data.registrationNumber?.trim()) {
      errors.push('Registration number is required');
    }
    if (!data.ntcPermitNumber?.trim()) {
      errors.push('NTC Permit number is required');
    }
    if (!data.permitExpiryDate) {
      errors.push('Permit expiry date is required');
    }
    if (!data.ownerName?.trim()) {
      errors.push('Owner name is required');
    }
    if (!data.ownerContactNumber?.trim()) {
      errors.push('Owner contact number is required');
    }
    if (!data.busModel?.trim()) {
      errors.push('Bus model is required');
    }
    if (!data.serviceType) {
      errors.push('Service type is required');
    }
    if (!data.totalSeats || data.totalSeats < 20 || data.totalSeats > 100) {
      errors.push('Total seats must be between 20 and 100');
    }
    if (!data.seatLayout) {
      errors.push('Seat layout is required');
    }

    // Validate date format
    try {
      const expiryDate = new Date(data.permitExpiryDate);
      if (expiryDate < new Date()) {
        errors.push('Permit expiry date must be in the future');
      }
    } catch {
      errors.push('Invalid permit expiry date format');
    }

    // Validate phone format (basic validation)
    const phoneRegex = /^[\d\s+()-]+$/;
    if (!phoneRegex.test(data.ownerContactNumber)) {
      errors.push('Invalid phone number format');
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors.join(', '));
    }
  }

  /**
   * Check for Existing Bus
   */
  private async checkExistingBus(registrationNumber: string): Promise<any> {
    const firestore = this.firebaseService.getFirestore();

    const snapshot = await firestore
      .collection('buses')
      .where('registrationNumber', '==', registrationNumber)
      .limit(1)
      .get();

    return snapshot.empty ? null : snapshot.docs[0].data();
  }

  /**
   * Upload Files to Cloud Storage
   */
  private async uploadFilesToStorage(
    files: Express.Multer.File[],
    userId: string,
  ): Promise<Record<string, string>> {
    const bucket = admin.storage().bucket();
    const documentUrls: Record<string, string> = {};

    for (const file of files) {
      try {
        const fileName = `buses/${userId}/${file.fieldname}-${Date.now()}`;
        const fileRef = bucket.file(fileName);

        // Upload file
        await fileRef.save(file.buffer, {
          metadata: {
            contentType: file.mimetype,
            metadata: {
              uploadedAt: new Date().toISOString(),
              originalName: file.originalname,
            },
          },
        });

        // Get signed URL (valid for 1 year)
        const [url] = await fileRef.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
        });

        documentUrls[file.fieldname] = url;
      } catch (error) {
        console.error(`Failed to upload file ${file.fieldname}:`, error);
        throw new BadRequestException(
          `Failed to upload ${file.fieldname}`,
        );
      }
    }

    return documentUrls;
  }

  /**
   * Create Bus Document in Firestore
   */
  private async createBusDocument(
    userId: string,
    busDetailsData: SubmitBusDetailsDto,
    documentUrls: Record<string, string>,
  ): Promise<any> {
    const firestore = this.firebaseService.getFirestore();
    const timestamp = admin.firestore.Timestamp.now();

    const busDocument = {
      driverId: userId,
      
      // Basic & Legal Details
      registrationNumber: busDetailsData.registrationNumber,
      ntcPermitNumber: busDetailsData.ntcPermitNumber,
      permitExpiryDate: new Date(busDetailsData.permitExpiryDate),
      
      // Owner Details
      ownerName: busDetailsData.ownerName,
      ownerContactNumber: busDetailsData.ownerContactNumber,
      
      // Specifications
      busModel: busDetailsData.busModel,
      serviceType: busDetailsData.serviceType,
      hasAC: busDetailsData.hasAC || false,
      
      // Seating
      totalSeats: busDetailsData.totalSeats,
      seatLayout: busDetailsData.seatLayout,
      
      // Amenities
      amenities: busDetailsData.amenities || {},
      
      // Documents
      documents: {
        frontViewUrl: documentUrls.frontView || null,
        sideViewUrl: documentUrls.sideView || null,
        interiorViewUrl: documentUrls.interiorView || null,
        permitDocumentUrl: documentUrls.permitDocument || null,
      },
      
      // Status
      status: 'PENDING_REVIEW',
      submittedAt: timestamp,
      approvedAt: null,
      approvedBy: null,
      rejectionReason: null,
      
      // Metadata
      isActive: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Add to Firestore
    const docRef = await firestore
      .collection('buses')
      .add(busDocument);

    return { id: docRef.id, ...busDocument };
  }

  /**
   * Notify Admins of New Bus Registration
   */
  private async notifyAdminsOfNewBusRegistration(
    busId: string,
    busData: SubmitBusDetailsDto,
  ) {
    try {
      const firestore = this.firebaseService.getFirestore();

      // Create notification in Firebase
      await firestore
        .collection('adminNotifications')
        .add({
          type: 'BUS_REGISTRATION_PENDING',
          busId: busId,
          busNumber: busData.registrationNumber,
          ownerName: busData.ownerName,
          message: `New bus registration ${busData.registrationNumber} pending approval`,
          read: false,
          createdAt: admin.firestore.Timestamp.now(),
        });

      console.log(`Admin notification created for bus ${busId}`);
    } catch (error) {
      console.error('Failed to notify admins:', error);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Send Confirmation Email to Driver
   */
  private async sendConfirmationToDriver(userId: string, busData: SubmitBusDetailsDto) {
    try {
      const firestore = this.firebaseService.getFirestore();

      // Get driver email
      const userDoc = await firestore
        .collection('users')
        .doc(userId)
        .get();

      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const userData = userDoc.data();
      const driverEmail = userData?.email;

      if (!driverEmail) {
        console.warn(`No email found for user ${userId}`);
        return;
      }

      // Send email (implement your email service here)
      console.log(`Sending confirmation email to ${driverEmail}`);
      
      // Example: Using SendGrid, Mailgun, or Firebase Cloud Functions
      // await this.emailService.sendBusRegistrationConfirmation(
      //   driverEmail,
      //   busData.registrationNumber,
      //   busData.busModel
      // );
    } catch (error) {
      console.error('Failed to send confirmation email:', error);
      // Don't throw - this is a non-critical operation
    }
  }
}

/**
 * ADDITIONAL FEATURES TO IMPLEMENT
 */

/**
 * 1. Admin Get Pending Registrations
 * GET /bus/registrations/pending
 */
// @Get('registrations/pending')
// async getPendingRegistrations() {
//   const firestore = this.firebaseService.getFirestore();
//   const snapshot = await firestore
//     .collection('buses')
//     .where('status', '==', 'PENDING_REVIEW')
//     .orderBy('submittedAt', 'desc')
//     .get();
//   return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
// }

/**
 * 2. Admin Approve Bus Registration
 * PATCH /bus/:id/approve
 */
// @Patch(':id/approve')
// async approveBusRegistration(
//   @Param('id') busId: string,
//   @Headers('authorization') authHeader: string,
// ) {
//   const adminId = await this.extractUserIdFromToken(authHeader);
//   const firestore = this.firebaseService.getFirestore();
//
//   await firestore
//     .collection('buses')
//     .doc(busId)
//     .update({
//       status: 'APPROVED',
//       isActive: true,
//       approvedAt: admin.firestore.Timestamp.now(),
//       approvedBy: adminId,
//     });
//
//   // Notify driver of approval
//   // ...
// }

/**
 * 3. Admin Reject Bus Registration
 * PATCH /bus/:id/reject
 */
// @Patch(':id/reject')
// async rejectBusRegistration(
//   @Param('id') busId: string,
//   @Body() { rejectionReason }: { rejectionReason: string },
//   @Headers('authorization') authHeader: string,
// ) {
//   const adminId = await this.extractUserIdFromToken(authHeader);
//   const firestore = this.firebaseService.getFirestore();
//
//   await firestore
//     .collection('buses')
//     .doc(busId)
//     .update({
//       status: 'REJECTED',
//       rejectionReason: rejectionReason,
//       rejectedAt: admin.firestore.Timestamp.now(),
//       rejectedBy: adminId,
//     });
//
//   // Notify driver of rejection with reason
//   // ...
// }

/**
 * 4. Cron Job - Auto Disable Expired Buses
 * Run daily to check and disable buses with expired permits
 */
// async autoDisableExpiredBuses() {
//   const firestore = this.firebaseService.getFirestore();
//   const today = new Date();
//
//   const snapshot = await firestore
//     .collection('buses')
//     .where('permitExpiryDate', '<', today)
//     .where('isActive', '==', true)
//     .get();
//
//   for (const doc of snapshot.docs) {
//     await doc.ref.update({
//       isActive: false,
//       disabledReason: 'Permit Expired',
//       disabledAt: admin.firestore.Timestamp.now(),
//     });
//
//     // Notify driver
//     // ...
//   }
// }
