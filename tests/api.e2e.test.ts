import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import { app } from '../index';
import Booking from '../models/Booking';
import Salon from '../models/Salon';
import Service from '../models/Service';
import User from '../models/User';

const CUSTOMER_PASSWORD = 'password123';
const APPOINTMENT_DATE = '2099-12-31';
const STYLIST_EMAIL = 'stylist@test.local';

describe('Salon backend', () => {
  let database: MongoMemoryServer;
  let salon: string;
  let haircut: string;
  let stylist: string;

  const bearerToken = (token: string) => `Bearer ${token}`;

  async function signInAsCustomer(email: string): Promise<string> {
    const registration = await request(app)
      .post('/api/register')
      .send({
        name: 'Test Customer',
        email,
        password: CUSTOMER_PASSWORD
      });

    expect(registration.status).toBe(201);

    const login = await request(app)
      .post('/api/login')
      .send({ email, password: CUSTOMER_PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));

    return login.body.token;
  }

  function bookingDetails(time: string, extraFields = {}) {
    return {
      salonId: salon,
      stylistId: stylist,
      serviceId: haircut,
      slotTime: time,
      date: APPOINTMENT_DATE,
      ...extraFields
    };
  }

  async function bookAppointment(token: string, time: string, extraFields = {}) {
    return request(app)
      .post('/api/bookings')
      .set('Authorization', bearerToken(token))
      .send(bookingDetails(time, extraFields));
  }

  async function cancelAppointment(bookingId: string, token: string) {
    return request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Authorization', bearerToken(token))
      .send();
  }

  beforeAll(async () => {
    database = await MongoMemoryServer.create();
    await mongoose.connect(database.getUri());

    const savedStylist = await User.create({
      name: 'Test Stylist',
      email: STYLIST_EMAIL,
      password: await bcrypt.hash('stylist123', 10),
      role: 'stylist'
    });
    stylist = savedStylist.id;

    const savedSalon = await Salon.create({
      name: 'Test Salon',
      location: 'Test Street',
      openTime: '09:00',
      closeTime: '18:00'
    });
    salon = savedSalon.id;

    const savedService = await Service.create({
      name: 'Test Haircut',
      duration: 30,
      price: 25,
      salonId: savedSalon._id
    });
    haircut = savedService.id;
  });

  afterEach(async () => {
    await Booking.deleteMany({});
    await User.deleteMany({ email: { $ne: STYLIST_EMAIL } });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  describe('authentication', () => {
    it('registers a customer and returns a token when they log in', async () => {
      const token = await signInAsCustomer('new-customer@test.local');

      expect(token).toEqual(expect.any(String));
    });

    it('does not allow the same email to be registered twice', async () => {
      await signInAsCustomer('existing-customer@test.local');

      const response = await request(app)
        .post('/api/register')
        .send({
          name: 'Second Account',
          email: 'existing-customer@test.local',
          password: CUSTOMER_PASSWORD
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Email already in use' });
    });

    it('rejects a login with the wrong password', async () => {
      await signInAsCustomer('login-test@test.local');

      const response = await request(app)
        .post('/api/login')
        .send({
          email: 'login-test@test.local',
          password: 'not-the-right-password'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid credentials' });
    });
  });

  describe('bookings', () => {
    it('creates and then cancels a customer appointment', async () => {
      const token = await signInAsCustomer('booking-owner@test.local');
      const created = await bookAppointment(token, '10:00');

      expect(created.status).toBe(201);
      expect(created.body.message).toBe('Booking created successfully');
      expect(created.body.booking).toEqual(expect.objectContaining({
        salonId: salon,
        stylistId: stylist,
        serviceId: haircut,
        date: APPOINTMENT_DATE,
        startTime: '10:00',
        endTime: '10:30',
        status: 'booked'
      }));

      const bookingId = created.body.booking._id;
      const cancelled = await cancelAppointment(bookingId, token);

      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toEqual({
        message: 'Booking cancelled successfully'
      });

      const storedBooking = await Booking.findById(bookingId);
      expect(storedBooking?.status).toBe('cancelled');
    });

    it('requires a date and a real service when creating an appointment', async () => {
      const token = await signInAsCustomer('validation@test.local');

      const withoutDate = await request(app)
        .post('/api/bookings')
        .set('Authorization', bearerToken(token))
        .send(bookingDetails('11:00', { date: undefined }));

      expect(withoutDate.status).toBe(400);
      expect(withoutDate.body).toEqual({ error: 'date is required' });

      const unknownService = await bookAppointment(token, '11:00', {
        serviceId: new mongoose.Types.ObjectId().toString()
      });

      expect(unknownService.status).toBe(404);
      expect(unknownService.body).toEqual({ error: 'Service not found' });
    });

    it('does not allow two active appointments in the same time slot', async () => {
      const firstCustomer = await signInAsCustomer('first-customer@test.local');
      const secondCustomer = await signInAsCustomer('second-customer@test.local');

      const firstAppointment = await bookAppointment(firstCustomer, '12:00');
      expect(firstAppointment.status).toBe(201);

      const conflictingAppointment = await bookAppointment(secondCustomer, '12:00');
      expect(conflictingAppointment.status).toBe(400);
      expect(conflictingAppointment.body).toEqual({
        error: 'Time slot is no longer available'
      });

      await cancelAppointment(firstAppointment.body.booking._id, firstCustomer);

      const replacementAppointment = await bookAppointment(secondCustomer, '12:00');
      expect(replacementAppointment.status).toBe(201);
    });
  });

  describe('access control', () => {
    it('rejects booking requests without a token', async () => {
      const response = await request(app)
        .post('/api/bookings')
        .send(bookingDetails('14:00'));

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('rejects cancellation requests without a token', async () => {
      const response = await request(app)
        .post('/api/bookings/507f1f77bcf86cd799439011/cancel')
        .send();

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('rejects an invalid bearer token', async () => {
      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', bearerToken('this-is-not-a-jwt'))
        .send(bookingDetails('14:00'));

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid token' });
    });

    it('prevents one customer from cancelling another customer’s appointment', async () => {
      const owner = await signInAsCustomer('appointment-owner@test.local');
      const stranger = await signInAsCustomer('different-customer@test.local');
      const appointment = await bookAppointment(owner, '15:00');

      const response = await cancelAppointment(
        appointment.body.booking._id,
        stranger
      );

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Not authorized to cancel this booking'
      });
    });
  });
});
