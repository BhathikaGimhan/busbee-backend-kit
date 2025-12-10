import { IsString, IsNotEmpty, IsEnum, IsBoolean, IsNumber, IsOptional, IsArray } from 'class-validator';

export enum BusType {
  REGULAR_ROUTE = 'regular_route',
  TRIP_AVAILABLE = 'trip_available',
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
}
