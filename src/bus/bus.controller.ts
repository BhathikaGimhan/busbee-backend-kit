import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
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
  async getApprovedBuses() {
    return await this.busService.getApprovedBuses();
  }

  @Get('rejected')
  @UseGuards(JwtAuthGuard)
  async getRejectedBuses() {
    return await this.busService.getRejectedBuses();
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

  @Post('trip')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createTrip(@Body() tripData: any, @Req() req: Request) {
    const authenticatedUser = req.user as { userId: string; email: string };

    // Verify the user owns the bus
    const firestore = this.firebaseService.getFirestore();
    const userDoc = await firestore
      .collection('users')
      .doc(authenticatedUser.userId)
      .get();

    if (!userDoc.exists || userDoc.data().userType !== 'driver') {
      throw new BadRequestException('Only drivers can create trips');
    }

    return await this.busService.createTrip({
      ...tripData,
      busId: authenticatedUser.userId, // Driver's userId is the busId
    });
  }

  @Get(':busId/trips')
  async getBusTrips(
    @Param('busId') busId: string,
    @Query('date') date?: string,
  ) {
    return await this.busService.getBusTrips(busId, date);
  }

  @Post('hire-request')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createHireRequest(@Body() requestData: any) {
    return await this.busService.createHireRequest(requestData);
  }

  @Get('hire-requests')
  @UseGuards(JwtAuthGuard)
  async getHireRequests(
    @Query('userId') userId: string,
    @Query('role') role: 'passenger' | 'driver',
  ) {
    return await this.busService.getHireRequests(userId, role);
  }

  @Patch('hire-request/:requestId/status')
  @UseGuards(JwtAuthGuard)
  async updateHireRequestStatus(
    @Param('requestId') requestId: string,
    @Body()
    body: {
      status:
        | 'price_quoted'
        | 'price_accepted'
        | 'confirmed'
        | 'rejected'
        | 'completed';
      finalPrice?: number;
      driverNotes?: string;
    },
  ) {
    return await this.busService.updateHireRequestStatus(
      requestId,
      body.status,
      body.finalPrice,
      body.driverNotes,
    );
  }

  // Booking management endpoints
  @Get('bookings/driver/:driverId')
  @UseGuards(JwtAuthGuard)
  async getDriverBookings(@Param('driverId') driverId: string) {
    return await this.busService.getDriverBookings(driverId);
  }

  @Get('bookings/passenger/:passengerId')
  @UseGuards(JwtAuthGuard)
  async getPassengerBookings(@Param('passengerId') passengerId: string) {
    return await this.busService.getPassengerBookings(passengerId);
  }

  @Patch('bookings/:bookingId/status')
  @UseGuards(JwtAuthGuard)
  async updateBookingStatus(
    @Param('bookingId') bookingId: string,
    @Body() body: { status: 'confirmed' | 'cancelled' },
  ) {
    return await this.busService.updateBookingStatus(bookingId, body.status);
  }

  // ==================== ROUTINE MANAGEMENT ENDPOINTS ====================

  @Post('routines')
  @UseGuards(JwtAuthGuard)
  async createRoutine(@Body() createRoutineDto: any) {
    return await this.busService.createRoutine(createRoutineDto);
  }

  @Get('routines/driver/:driverId')
  @UseGuards(JwtAuthGuard)
  async getRoutinesByDriver(@Param('driverId') driverId: string) {
    return await this.busService.getRoutinesByDriver(driverId);
  }

  @Get('routines/bus/:busId')
  async getRoutinesByBus(@Param('busId') busId: string) {
    return await this.busService.getRoutinesByBus(busId);
  }

  @Get('routines/pending')
  @UseGuards(JwtAuthGuard)
  async getPendingRoutines() {
    return await this.busService.getPendingRoutines();
  }

  @Patch('routines/:routineId')
  @UseGuards(JwtAuthGuard)
  async updateRoutine(
    @Param('routineId') routineId: string,
    @Body() updateData: any,
  ) {
    return await this.busService.updateRoutine(routineId, updateData);
  }

  @Patch('routines/:routineId/status')
  @UseGuards(JwtAuthGuard)
  async updateRoutineStatus(
    @Param('routineId') routineId: string,
    @Body() body: { status: string; rejectionReason?: string },
  ) {
    return await this.busService.updateRoutineStatus(
      routineId,
      body.status,
      body.rejectionReason,
    );
  }

  @Delete('routines/:routineId')
  @UseGuards(JwtAuthGuard)
  async deleteRoutine(@Param('routineId') routineId: string) {
    return await this.busService.deleteRoutine(routineId);
  }

  // ==================== DAILY SCHEDULE ENDPOINTS ====================

  @Get('schedule/today/:driverId')
  @UseGuards(JwtAuthGuard)
  async getTodaySchedule(
    @Param('driverId') driverId: string,
    @Query('date') date: string,
  ) {
    return await this.busService.getTodaySchedule(driverId, date);
  }

  @Patch('schedule/daily/:routineId')
  @UseGuards(JwtAuthGuard)
  async updateDailyRoutineStatus(
    @Param('routineId') routineId: string,
    @Body() body: { date: string; availability: string; notes?: string },
  ) {
    return await this.busService.updateDailyRoutineStatus(
      routineId,
      body.date,
      body.availability,
      body.notes,
    );
  }

  // ==================== SEARCH WITH SCHEDULES ====================

  @Get('search/schedules')
  async searchBusesWithSchedules(
    @Query('route') route: string,
    @Query('date') date: string,
  ) {
    if (!route || !date) {
      throw new BadRequestException('Route and date are required');
    }
    return await this.busService.searchBusesWithSchedules(route, date);
  }

  // ==================== BUS PRICING ENDPOINTS ====================

  @Patch('pricing/:driverId')
  @UseGuards(JwtAuthGuard)
  async updateBusPricing(
    @Param('driverId') driverId: string,
    @Body() pricingData: any,
  ) {
    return await this.busService.updateBusPricing(driverId, pricingData);
  }

  @Get('pricing/:driverId')
  @UseGuards(JwtAuthGuard)
  async getBusPricing(@Param('driverId') driverId: string) {
    return await this.busService.getBusPricing(driverId);
  }

  // ==================== LOCATION SUGGESTIONS ====================

  @Get('locations/suggestions')
  async getLocationSuggestions() {
    return await this.busService.getLocationSuggestions();
  }

  // ==================== ROUTES MANAGEMENT ENDPOINTS ====================

  @Get('routes')
  @UseGuards(JwtAuthGuard)
  async getRoutes() {
    return await this.busService.getRoutes();
  }

  @Post('routes')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async addRoute(@Body() body: { route: string }) {
    return await this.busService.addRoute(body.route);
  }

  @Put('routes/:route')
  @UseGuards(JwtAuthGuard)
  async updateRoute(
    @Param('route') oldRoute: string,
    @Body() body: { route: string },
  ) {
    return await this.busService.updateRoute(oldRoute, body.route);
  }

  @Delete('routes/:route')
  @UseGuards(JwtAuthGuard)
  async deleteRoute(@Param('route') route: string) {
    return await this.busService.deleteRoute(route);
  }

  // ==================== ROUTE REQUESTS ENDPOINTS ====================

  @Post('route-request')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createRouteRequest(
    @Body() body: { route: string },
    @Req() req: Request,
  ) {
    const authenticatedUser = req.user as { userId: string; email: string };
    return await this.busService.createRouteRequest(
      body.route,
      authenticatedUser.userId,
    );
  }

  @Get('route-requests')
  @UseGuards(JwtAuthGuard)
  async getRouteRequests() {
    return await this.busService.getRouteRequests();
  }

  @Post('route-requests/:requestId/approve')
  @UseGuards(JwtAuthGuard)
  async approveRouteRequest(@Param('requestId') requestId: string) {
    return await this.busService.approveRouteRequest(requestId);
  }

  @Post('route-requests/:requestId/reject')
  @UseGuards(JwtAuthGuard)
  async rejectRouteRequest(@Param('requestId') requestId: string) {
    return await this.busService.rejectRouteRequest(requestId);
  }
}
