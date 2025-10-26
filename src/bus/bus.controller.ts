import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  BadRequestException,
  Delete,
} from '@nestjs/common';
import { BusService } from './bus.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';
import { FirebaseService } from '../firebase/firebase.service';

@Controller('bus')
export class BusController {
  constructor(
    private readonly busService: BusService,
    private readonly firebaseService: FirebaseService,
  ) {}

  @Get('pending')
  @UseGuards(JwtAuthGuard)
  async getPendingBusRegistrations() {
    return await this.busService.getPendingBusRegistrations();
  }

  @Post(':userId/approve')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async approveBusRegistration(@Param('userId') userId: string) {
    return await this.busService.approveBusRegistration(userId);
  }

  @Post(':userId/reject')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async rejectBusRegistration(
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
  ) {
    return await this.busService.rejectBusRegistration(userId, body.reason);
  }

  @Get('approved')
  @UseGuards(JwtAuthGuard)
  async getApprovedBuses() {
    return await this.busService.getApprovedBuses();
  }

  @Post('book')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async bookSeats(@Body() bookingData: any, @Req() req: Request) {
    // Get authenticated user from JWT
    const authenticatedUser = req.user as { userId: string; email: string };

    console.log('🔐 Authenticated user from JWT:', authenticatedUser);
    console.log('📋 Booking data userId:', bookingData.userId);

    // Validate that the userId in booking data matches authenticated user
    if (bookingData.userId !== authenticatedUser.userId) {
      console.log('❌ User ID mismatch detected');
      throw new BadRequestException(
        'User ID mismatch - booking must be for authenticated user',
      );
    }

    console.log('✅ User ID validation passed');
    return await this.busService.bookSeats(bookingData);
  }

  @Get('search')
  async searchBuses(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('date') date?: string,
  ) {
    return await this.busService.searchBuses({ from, to, date });
  }

  @Get(':busId/seats')
  async getSeatAvailability(
    @Param('busId') busId: string,
    @Query('date') date: string,
  ) {
    return await this.busService.getSeatAvailability(busId, date);
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  async getUser(@Param('userId') userId: string) {
    const firestore = this.firebaseService.getFirestore();
    const userDoc = await firestore.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return { exists: false, message: 'User not found' };
    }

    return { exists: true, user: userDoc.data() };
  }

  @Delete(':busId/seats')
  @UseGuards(JwtAuthGuard)
  async clearSeatAvailability(
    @Param('busId') busId: string,
    @Query('date') date: string,
  ) {
    const firestore = this.firebaseService.getFirestore();
    const seatAvailabilityRef = firestore
      .collection('seatAvailability')
      .doc(`${busId}_${date}`);

    await seatAvailabilityRef.delete();
    return { message: 'Seat availability cleared successfully' };
  }
}
