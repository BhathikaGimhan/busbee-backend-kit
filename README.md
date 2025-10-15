# BusBee Backend

NestJS backend with Firebase Authentication for the BusBee application.

## Description

Backend API for the BusBee bus tracking and booking system, built with [NestJS](https://github.com/nestjs/nest) and integrated with Firebase Authentication.

## Setup Instructions

### 1. Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Go to Project Settings > Service Accounts
4. Click "Generate New Private Key" to download the service account JSON file
5. Enable Authentication > Sign-in method > Email/Password
6. Get your Web API Key from Project Settings > General

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in your Firebase credentials:

```bash
cp .env.example .env
```

Update the following values in `.env`:

- `FIREBASE_PROJECT_ID`: Your Firebase project ID
- `FIREBASE_PRIVATE_KEY`: Private key from the service account JSON (keep the quotes and \n characters)
- `FIREBASE_CLIENT_EMAIL`: Client email from the service account JSON
- `FIREBASE_API_KEY`: Web API Key from Firebase Console
- `JWT_SECRET`: A secure random string for JWT signing

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run start:prod
```

The server will run on `http://localhost:3000`

## API Endpoints

### Authentication

#### Register

- **POST** `/auth/register`
- Body:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "John Doe"
}
```

#### Login

- **POST** `/auth/login`
- Body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### Get Profile (Protected)

- **GET** `/auth/profile`
- Headers:

```
Authorization: Bearer <your-jwt-token>
```

## Project Structure

```
src/
├── auth/                   # Authentication module
│   ├── dto/               # Data transfer objects
│   ├── guards/            # Auth guards
│   ├── strategies/        # Passport strategies
│   ├── auth.controller.ts # Auth endpoints
│   ├── auth.module.ts     # Auth module
│   └── auth.service.ts    # Auth business logic
├── firebase/              # Firebase integration
│   ├── firebase.module.ts # Firebase module
│   └── firebase.service.ts # Firebase service
├── app.module.ts          # Root module
└── main.ts                # Application entry point
```

## Features

- ✅ Firebase Authentication integration
- ✅ JWT token-based authentication
- ✅ User registration and login
- ✅ Password validation (minimum 6 characters)
- ✅ Email validation
- ✅ Protected routes with JWT guards
- ✅ CORS enabled for frontend integration
- ✅ Global validation pipes
- ✅ Clean and modular architecture

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
