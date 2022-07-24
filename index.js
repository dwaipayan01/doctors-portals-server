const express = require("express");
const cors = require("cors");
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express();
require('dotenv').config();
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
async function run() {
    try {
        await client.connect();
        const servicesCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('bookings');
        const userCollection = client.db('doctors_portal').collection('users');

        app.get("/service", async (req, res) => {
            const query = {};
            const cursor = servicesCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);

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

        })
        app.post("/booking", async (req, res) => {
            const booking = req.body;
            const query = { name: booking.name, date: booking.date, patient: booking.patient }
            console.log(query)
            const exsits = await bookingCollection.findOne(query);
            if (exsits) {
                return res.send({ success: false, booking: exsits })
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        });
        app.get("/user", verifyJwt, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });
        app.put("/user/admin/:email", verifyJwt, async (req, res) => {
            const email = req.params.email;
            const requester = req.decoded.email;
            console.log(requester);
            const requestAccount = await userCollection.findOne({ email: requester });
            if (requestAccount.role === "admin") {
                const filter = { email: email };
                const updateDoc = {
                    $set: { role: "admin" },
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result);
            }
            else {
                res.status(403).send("Forbidden access");
            }


        });
        app.get("/admin/:email", async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const admin = user.role === "admin";
            res.send({ admin: admin });
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