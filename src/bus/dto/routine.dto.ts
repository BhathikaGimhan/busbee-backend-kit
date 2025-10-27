import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum RoutineStatus {
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum RoutineAvailability {
  AVAILABLE = 'available',
  STARTED = 'started',
  COMPLETED = 'completed',
  UNAVAILABLE = 'unavailable',
}

export class TimeSlotDto {
  @IsString()
  @IsNotEmpty()
  startTime: string; // Format: "08:30"

  @IsString()
  @IsNotEmpty()
  endTime: string; // Format: "12:30"
}

export class RoutineDto {
  @IsString()
  @IsNotEmpty()
  routineName: string; // e.g., "Routine 1", "Morning Shift"

  @IsString()
  @IsNotEmpty()
  route: string; // e.g., "Colombo to Kandy"

  @ValidateNested()
  @Type(() => TimeSlotDto)
  timeSlot: TimeSlotDto;

  @IsNumber()
  @Min(0)
  pricePerPerson: number;

  @IsNumber()
  @Min(0)
  bookingCommission: number; // Percentage (0-100)

  @IsArray()
  @IsString({ each: true })
  daysOfWeek: string[]; // ["Monday", "Tuesday", etc.]
}

export class CreateRoutineDto extends RoutineDto {
  @IsString()
  @IsNotEmpty()
  busId: string;

  @IsString()
  @IsNotEmpty()
  driverId: string;
}

export class UpdateRoutineDto {
  @IsOptional()
  @IsString()
  routineName?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TimeSlotDto)
  timeSlot?: TimeSlotDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerPerson?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bookingCommission?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  daysOfWeek?: string[];
}

export class UpdateRoutineStatusDto {
  @IsEnum(RoutineStatus)
  status: RoutineStatus;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class UpdateDailyRoutineStatusDto {
  @IsEnum(RoutineAvailability)
  availability: RoutineAvailability;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class BusPricingDto {
  @IsNumber()
  @Min(0)
  defaultPricePerPerson: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  bookingCommission?: number; // Default commission percentage
}
