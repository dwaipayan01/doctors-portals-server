const express = require("express");
const cors = require("cors");
const jwt = require('jsonwebtoken');
var nodemailer = require('nodemailer');
var sgTransport = require('nodemailer-sendgrid-transport');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.uuqup.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
function verifyJwt(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized access" });

    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: "Forbidden access" });
        }

        req.decoded = decoded;
        next();

    });
}
const Emialoptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY
    }
}
const EmailClient = nodemailer.createTransport(sgTransport(Emialoptions));

function sendAppointmentEmail(booking) {
    const { patientEmail, name, date, slot, patient } = booking;
    var email = {
        from: process.env.EMAIL_SENDER,
        to: process.env.EMAIL_SENDER,
        subject: `Your ${name} appointment is booking on${date} at${slot}`,
        text: `Your ${name} appointment is booking on${date} at${slot}`,
        html: `
           <h1>Hello ${patient}</h1>
           <p>Your Booking is confirm.</p>
           <p>Looking forword to see you on ${date} at ${slot}</p>
           <h1>Our address</h1>
           <p>Sylhet</p>
        `
    };
    EmailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent: ', info);
        }
    });
}
async function run() {
    try {
        await client.connect();
        const servicesCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('bookings');
        const userCollection = client.db('doctors_portal').collection('users');
        const doctorCollection = client.db('doctors_portal').collection('doctors');
        const paymentsCollection = client.db('doctors_portal').collection('payments');

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requestAccount = await userCollection.findOne({ email: requester });
            if (requestAccount.role === "admin") {
                next();
            }
            else {
                return res.status(403).send({ message: "Forbidden access" });
            }
        }

        app.get("/service", async (req, res) => {
            const query = {};
            const cursor = servicesCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);

        });
        app.post('/create-payment-intent', verifyJwt, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        });
        app.get("/available", async (req, res) => {
            const date = req.query.date;
            const services = await servicesCollection.find().toArray();

            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            services.forEach(service => {
                const serviceBookings = bookings.filter(book => book.name === service.name);
                const bookedSlots = serviceBookings.map(book => book.slot);
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                service.slots = available;
            })
            res.send(services);
        });
        app.get("/booking", verifyJwt, async (req, res) => {
            const patientEmail = req.query.patientEmail;
            console.log(patientEmail);
            const decodedEmail = req.decoded.email;
            console.log(decodedEmail);
            if (patientEmail === decodedEmail) {
                const query = { patientEmail: patientEmail };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            }
            else {
                return res.status(403).send({ message: "Forbidden access" });
            }


        });
        app.get("/booking/:id", verifyJwt, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        });
        app.patch('/booking/:id', verifyJwt, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }

            const result = await paymentsCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedBooking);
        })
        app.post("/booking", async (req, res) => {
            const booking = req.body;
            const query = { name: booking.name, date: booking.date, patient: booking.patient }
            console.log(query)
            const exsits = await bookingCollection.findOne(query);
            if (exsits) {
                return res.send({ success: false, booking: exsits })
            }
            sendAppointmentEmail(booking)
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        });
        app.get("/user", verifyJwt, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });
        app.put("/user/admin/:email", verifyJwt, verifyAdmin, async (req, res) => {
            const email = req.params.email;

            const filter = { email: email };
            const updateDoc = {
                $set: { role: "admin" },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);



        });
        app.get("/admin/:email", async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const admin = user.role === "admin";
            res.send({ admin: admin });
        });
        app.get("/doctor", verifyJwt, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        })
        app.put("/user/:email", async (req, res) => {
            const email = req.params.email;
            console.log(email);
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: "1h"
            })
            res.send({ result, token });

        });
        app.post("/doctor", verifyJwt, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        })
        app.delete("/doctor/:email", verifyJwt, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        })

    }
    finally {

    }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("Doctor portal is ready");
});
app.listen(port, () => {
    console.log("Listening to port", port);
})