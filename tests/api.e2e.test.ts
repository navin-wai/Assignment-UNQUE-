// TASK ->
// Automate the complete E2E workflow: 
// Example - 
// Register → Login → Booking → Cancel
// Cover both positive and negative scenarios.
// Include authentication and authorization testing.
// Validate HTTP status codes, response data, and relevant business rules.
// Keep the automation maintainable and avoid unnecessary duplication.

import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { app } from '../index';
import Booking from '../models/Booking';
import Salon from '../models/Salon';
import Service from '../models/Service';
import User from '../models/User';

describe('Salon API E2E workflow', () => {
  let mongoServer: MongoMemoryServer;
  let salonId: string;
  let serviceId: string;
  let stylistId: string;

  const bookingDate = '2099-12-31';


  //return token
  const registerAndLogin = async (email: string) => {
    const registration = await request(app)
      .post('/api/register')
      .send({ name: 'Test Customer', email, password: 'password123' });

    expect(registration.status).toBe(201);

    const login = await request(app)
      .post('/api/login')
      .send({ email, password: 'password123' });

    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));
    return login.body.token as string;
  };

  //connect to db and create objects
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    const stylist = await User.create({
      name: 'Test Stylist',
      email: 'stylist@test.local',
      password: await bcrypt.hash('stylist123', 10),
      role: 'stylist'
    });
    stylistId = stylist.id;

    const salon = await Salon.create({
      name: 'Test Salon',
      location: 'Test Street',
      openTime: '09:00',
      closeTime: '18:00'
    });
    salonId = salon.id;

    const service = await Service.create({
      name: 'Test Haircut',
      duration: 30,
      price: 25,
      salonId: salon._id
    });
    serviceId = service.id;
  });

  //deleting after every test

  afterEach(async () => {
    await Booking.deleteMany({});
    await User.deleteMany({ email: { $ne: 'stylist@test.local' } });
  });

  //stop mongodb connection

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });


  //register -> login -> booking -> cancel 

  it('completes register -> login -> booking -> cancel and returns business data', async () => {
    const token = await registerAndLogin('customer@test.local');

    const bookingResponse = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        salonId,
        stylistId,
        serviceId,
        slotTime: '10:00',
        date: bookingDate
      });

    expect(bookingResponse.status).toBe(201);
    expect(bookingResponse.body.message).toBe('Booking created successfully');
    expect(bookingResponse.body.booking).toEqual(expect.objectContaining({
      salonId,
      stylistId,
      serviceId,
      date: bookingDate,
      startTime: '10:00',
      endTime: '10:30',
      status: 'booked'
    }));

    const cancellation = await request(app)
      .post(`/api/bookings/${bookingResponse.body.booking._id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(cancellation.status).toBe(200);
    expect(cancellation.body).toEqual({ message: 'Booking cancelled successfully' });
    await expect(Booking.findById(bookingResponse.body.booking._id)).resolves.toEqual(
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  //duplicate and invalidLogin
  it('rejects duplicate registration and invalid login credentials', async () => {
    await registerAndLogin('duplicate@test.local');

    const duplicate = await request(app)
      .post('/api/register')
      .send({ name: 'Another Customer', email: 'duplicate@test.local', password: 'password123' });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error).toBe('Email already in use');

    const invalidLogin = await request(app)
      .post('/api/login')
      .send({ email: 'duplicate@test.local', password: 'wrong-password' });
    expect(invalidLogin.status).toBe(400);
    expect(invalidLogin.body.error).toBe('Invalid credentials');
  });

  //enfore authentication while booking and cacellation
  it('enforces authentication on booking and cancellation endpoints', async () => {
    const booking = await request(app)
      .post('/api/bookings')
      .send({ salonId, stylistId, serviceId, slotTime: '11:00', date: bookingDate });
    expect(booking.status).toBe(401);
    expect(booking.body.error).toBe('Authentication required');

    const cancellation = await request(app)
      .post('/api/bookings/507f1f77bcf86cd799439011/cancel')
      .send();
    expect(cancellation.status).toBe(401);
    expect(cancellation.body.error).toBe('Authentication required');
  });

  it('rejects malformed authentication tokens', async () => {
    const response = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer not-a-jwt')//bearer token (not a JWT )
      .send({ salonId, stylistId, serviceId, slotTime: '11:00', date: bookingDate });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid token');
  });

  // required booking data should also be there
  it('validates required booking data and referenced services', async () => {
    const token = await registerAndLogin('validation@test.local');

    const missingDate = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ salonId, stylistId, serviceId, slotTime: '11:00' });
    expect(missingDate.status).toBe(400);
    expect(missingDate.body.error).toBe('date is required');

    const missingService = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        salonId,
        stylistId,
        serviceId: new mongoose.Types.ObjectId().toString(),
        slotTime: '11:00',
        date: bookingDate
      });
    expect(missingService.status).toBe(404);
    expect(missingService.body.error).toBe('Service not found');
  });

  //prevent overlap booking (available again ? )
  it('prevents overlapping bookings for the same stylist and allows the slot after cancellation', async () => {
    const firstToken = await registerAndLogin('first@test.local');
    const secondToken = await registerAndLogin('second@test.local');

    const firstBooking = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${firstToken}`)//first token de diya
      .send({ salonId, stylistId, serviceId, slotTime: '12:00', date: bookingDate });
    expect(firstBooking.status).toBe(201);

    const conflict = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${secondToken}`)//second token de diya
      .send({ salonId, stylistId, serviceId, slotTime: '12:00', date: bookingDate });
    expect(conflict.status).toBe(400);
    expect(conflict.body.error).toBe('Time slot is no longer available');

    await request(app)
      .post(`/api/bookings/${firstBooking.body.booking._id}/cancel`)
      .set('Authorization', `Bearer ${firstToken}`)
      .send()
      .expect(200);

    const availableAgain = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${secondToken}`)
      .send({ salonId, stylistId, serviceId, slotTime: '12:00', date: bookingDate });
    expect(availableAgain.status).toBe(201);
  });

  //cancelling from another coustomer 
  it('prevents a customer from cancelling another customer booking', async () => {
    const ownerToken = await registerAndLogin('owner@test.local');
    const otherToken = await registerAndLogin('other@test.local');

    const booking = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ salonId, stylistId, serviceId, slotTime: '13:00', date: bookingDate });

    const unauthorizedCancellation = await request(app)
      .post(`/api/bookings/${booking.body.booking._id}/cancel`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send();

    expect(unauthorizedCancellation.status).toBe(403);
    expect(unauthorizedCancellation.body.error).toBe('Not authorized to cancel this booking');
  });
});
