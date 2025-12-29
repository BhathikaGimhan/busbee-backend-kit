import { IsString, IsNotEmpty, IsEnum, IsBoolean, IsNumber, IsOptional, IsArray, IsDate, IsObject } from 'class-validator';

export enum BusType {
  REGULAR_ROUTE = 'regular_route',
  TRIP_AVAILABLE = 'trip_available',
}

export enum ServiceType {
  NORMAL = 'normal',
  SEMI_LUXURY = 'semi-luxury',
  LUXURY = 'luxury',
  SUPER_LUXURY = 'super-luxury',
}

export enum SeatLayout {
  TWO_BY_TWO = '2x2',
  TWO_BY_THREE = '2x3',
  ONE_BY_TWO = '1x2',
}

export class BusAmenities {
  @IsBoolean()
  @IsOptional()
  wifi?: boolean;

  @IsBoolean()
  @IsOptional()
  mobileCharging?: boolean;

  @IsBoolean()
  @IsOptional()
  adjustableSeats?: boolean;

  @IsBoolean()
  @IsOptional()
  tvAudioSystem?: boolean;

  @IsBoolean()
  @IsOptional()
  luggageSpace?: boolean;

  @IsBoolean()
  @IsOptional()
  curtains?: boolean;
}

export class BusDocuments {
  @IsString()
  @IsOptional()
  frontViewUrl?: string;

  @IsString()
  @IsOptional()
  sideViewUrl?: string;

  @IsString()
  @IsOptional()
  interiorViewUrl?: string;

  @IsString()
  @IsOptional()
  permitDocumentUrl?: string;
}

export class AddBusDto {
  @IsString()
  @IsNotEmpty()
  busName: string;

  @IsString()
  @IsNotEmpty()
  busNumber: string;

  @IsNumber()
  numberOfSeats: number;

  @IsEnum(BusType)
  busType: BusType;

  @IsBoolean()
  availableForTrips: boolean;

  @IsString()
  @IsOptional()
  route?: string;

  @IsArray()
  @IsOptional()
  operatingDays?: string[];

  // Bus Details Form Fields
  @IsString()
  @IsOptional()
  registrationNumber?: string;

  @IsString()
  @IsOptional()
  ntcPermitNumber?: string;

  @IsString()
  @IsOptional()
  permitExpiryDate?: string;

  @IsString()
  @IsOptional()
  ownerName?: string;

  @IsString()
  @IsOptional()
  ownerContactNumber?: string;

  @IsString()
  @IsOptional()
  busModel?: string;

  @IsEnum(ServiceType)
  @IsOptional()
  serviceType?: ServiceType;

  @IsBoolean()
  @IsOptional()
  hasAC?: boolean;

  @IsEnum(SeatLayout)
  @IsOptional()
  seatLayout?: SeatLayout;

  @IsObject()
  @IsOptional()
  amenities?: BusAmenities;

  @IsObject()
  @IsOptional()
  @IsObject()
  @IsOptional()
  documents?: BusDocuments;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  customFeatures?: string[];
}
