import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  MinLength,
  Min,
  IsEnum,
  IsArray,
  ArrayNotEmpty,
} from 'class-validator';

export enum UserType {
  PASSENGER = 'passenger',
  DRIVER = 'driver',
  ADMIN = 'admin',
}

export enum BusType {
  REGULAR_ROUTE = 'regular_route',
  TRIP_AVAILABLE = 'trip_available',
}

export enum BusStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum DayOfWeek {
  MONDAY = 'monday',
  TUESDAY = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY = 'thursday',
  FRIDAY = 'friday',
  SATURDAY = 'saturday',
  SUNDAY = 'sunday',
}

export class BusDetailsDto {
  @IsString()
  @IsNotEmpty()
  busName: string;

  @IsString()
  @IsNotEmpty()
  busNumber: string;

  @IsNumber()
  @Min(1)
  numberOfSeats: number;

  @IsEnum(BusType)
  busType: BusType;

  @IsBoolean()
  @IsOptional()
  availableForTrips?: boolean;

  @IsString()
  @IsOptional()
  route?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(DayOfWeek, { each: true })
  operatingDays: DayOfWeek[];
}

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsEnum(UserType)
  @IsOptional()
  userType?: UserType;

  @IsOptional()
  busDetails?: BusDetailsDto;
}
