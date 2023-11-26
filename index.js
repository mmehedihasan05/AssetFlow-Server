import Express, { query } from "express";
import cors from "cors";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import Stripe from "stripe";

dotenv.config();

const app = Express();
const port = process.env.PORT || 5000;
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
app.use(
    cors({
        origin: [
            "http://localhost:5100",
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
            "https://technest-blog.web.app",
        ], // The domains where the client side will run

        credentials: true, // This will help to set cookies
    })
);

app.use(Express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.cx7zh4x.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

function extractuserEmail(req, method) {
    if (method === "GET" || method === "DELETE") {
        return req.query.email || "";
    } else if (method === "POST" || method === "PUT" || method === "PATCH") {
        return req.body.email || "";
    } else {
        return "";
    }
}

function extractuserId(req, method) {
    if (method === "GET" || method === "DELETE") {
        return req.query.userId || "";
    } else if (method === "POST" || method === "PUT" || method === "PATCH") {
        return req.body.userId || "";
    } else {
        return "";
    }
}

// middlewares
const verifyToken = async (req, res, next) => {
    const token = req.cookies?.token;

    if (!token) {
        return res.status(401).send({ message: "unauthorized" });
    }
    console.log("verifyToken");
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        //    error
        if (err) {
            console.log(err);
            return res.status(401).send({ message: "unauthorized" });
        }

        req.user = decoded;

        // if its valid it will be decoded
        next();
    });
};

const requestValidate = async (req, res, next) => {
    const method = req.method;

    let decoded_Email = req.user?.userEmail;

    const userEmail = extractuserEmail(req, method);

    const requestedUrl = req.originalUrl;

    console.log(req.user);
    console.log("Request Validate", { decoded_Email, userEmail });

    if (decoded_Email !== userEmail) {
        return res.status(401).send({ message: "unauthorized" });
    }

    // console.log(200, "Authorized successfully.");
    next();
};

async function mainProcess() {
    try {
        // await client.connect();
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");

        const users = client.db("a12-assetflow").collection("users");
        const products = client.db("a12-assetflow").collection("products");
        const misc = client.db("a12-assetflow").collection("misc");

        const userInformationFetch = async (email) => {
            const query = { userEmail: email };

            const userInfoResult = await users.findOne(query);

            return userInfoResult;
        };

        // hr verify middleware
        const verifyHR = async (req, res, next) => {
            let decoded_Email = req.user?.userEmail;
            const userInfoResult = await userInfoFetch(decoded_Email);

            if (userInfoResult.userRole === "hr") {
                req.userInformation = userInfoResult;
                next();
            } else {
                return res.status(403).send({ message: "forbidden access" });
            }
        };

        const verifyEmployee = async (req, res, next) => {
            let decoded_Email = req.user?.userEmail;

            const userInfoResult = await userInfoFetch(decoded_Email);

            if (userInfoResult.userRole === "employee") {
                req.userInformation = userInfoResult;
                next();
            } else {
                return res.status(403).send({ message: "forbidden access" });
            }
        };

        const userInfoFetch = async (queryEmail) => {
            const query = { userEmail: queryEmail };
            const userInfoResult = await users.findOne(query);
            return userInfoResult;
        };

        const productListFetch = async (queryEmail) => {
            const query = { productAddedBy: queryEmail };
            let productsResult = await products.find(query).toArray();
            return productsResult;
        };

        // Authenticating
        app.post("/authenticate", async (req, res) => {
            const userEmail = req.body.email;
            const userId = req.body.userId;

            const token = jwt.sign({ userEmail }, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: "24h",
            });

            // For localhost
            const cookieOptionsLocal = {
                httpOnly: true, // jehetu localhost tai http only
                secure: false, // localhost tai secure false
                sameSite: false, // localhost and server er port different tai none
            };

            const cookieOptionsProd = {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
            };

            // User info fetching
            // email uppercase lowercase hole match kore na.
            // const query = { userEmail: userEmail };
            const query = { userEmail: { $regex: new RegExp(userEmail, "i") } };

            const userInformation = await users.findOne(query);

            console.log("userInformation authenticate", userInformation);

            res.cookie("token", token, cookieOptionsProd);

            res.send({ success: true, userInformation });
        });

        // Logout
        app.post("/logout", async (req, res) => {
            // res.clearCookie("token", { maxAge: 0 });
            res.clearCookie("token", {
                maxAge: 0,
                secure: process.env.NODE_ENV === "production" ? true : false,
                sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
            });

            res.send({ success: true });
        });

        // Eta kivabe secure korbo bujhtesi na.
        // user register, google/github login hole etay request ashe.
        // Users insertion
        app.post("/createuser", async (req, res) => {
            const userInformation = req.body;

            // user existance
            const query = { userEmail: userInformation?.userEmail };
            const userExistence = await users.findOne(query);

            console.log("userExistence", query, userExistence);

            if (userExistence?.userEmail) {
                return res.send({
                    userInsertResult: { userExists: true },
                    userInformation: userExistence,
                });
            } else {
                const updatedUserInformation = {
                    ...userInformation,
                    currentWorkingCompanyEmail: null,
                    currentWorkingCompanyImage: null,
                    currentWorkingCompanyName: null,
                    currentMemberShipLimit: 0,
                    currentEmployees: [],
                };
                console.log(updatedUserInformation);
                const userInsertResult = await users.insertOne(updatedUserInformation);
                console.log("create user ", updatedUserInformation, userInsertResult);
                return res.send({ userInsertResult, userInformation: updatedUserInformation });
            }
        });

        // Public Api
        app.get("/packages", async (req, res) => {
            const packagesData = await misc.findOne({ name: "packages" });
            res.send(packagesData.data);
        });

        // All Products
        // Security: Verify token. Used by both employee and HR
        app.get("/product", verifyToken, requestValidate, async (req, res) => {
            let decoded_Email = req.user?.userEmail;

            const userInfoResult = await userInfoFetch(decoded_Email);

            /*
            HR hole tar email diye search dile e data eshe jabe. 
            Employee hole currentWorkingCompanyEmail diye search dite hbe.
            Employee and currentWorkingCompanyEmail o na thakle data jabe na.
            */

            let emailToQuery = null;
            if (userInfoResult.userRole === "hr") {
                emailToQuery = userInfoResult.userEmail;
            } else if (
                userInfoResult.userRole === "employee" &&
                userInfoResult?.currentWorkingCompanyEmail
            ) {
                emailToQuery = userInfoResult.currentWorkingCompanyEmail;
            }
            /*
            title
availability
type
sort

  title: 'Asus',
  availability: 'available',
  type: 'non_returnable',
  sort: 'lowToHigh'
             */

            let queryReq = req.query;
            let searchQuery = {};

            // title : productName
            if (queryReq?.title) {
                searchQuery.productName = { $regex: new RegExp(queryReq?.title, "i") };
            }

            // type : productType
            if (queryReq?.type) {
                searchQuery.productType = queryReq?.type;
            }

            // availability : productQuantity
            if (queryReq?.availability) {
                if (queryReq?.availability === "available") {
                    searchQuery.productQuantity = { $gte: 1 };
                } else if (queryReq?.availability === "unavailable") {
                    searchQuery.productQuantity = { $lt: 1 };
                }
            }

            let sortQuery = {};
            if (queryReq?.sort === "lowToHigh") {
                sortQuery.productQuantity = 1;
            } else if (queryReq?.sort === "highToLow") {
                sortQuery.productQuantity = -1;
            }

            if (emailToQuery) {
                searchQuery.productAddedBy = emailToQuery;

                console.log({ searchQuery });

                let productList = await products.find(searchQuery).sort(sortQuery).toArray();

                return res.send(productList);
            } else {
                return res.send([]);
            }
        });

        // Add Product
        // Security: Verify HR
        app.post("/product/add", verifyToken, requestValidate, verifyHR, async (req, res) => {
            console.log("product add ", req.body?.productInformation);

            const productInsertResult = await products.insertOne(req.body?.productInformation);

            res.send(productInsertResult);
        });

        // To see and delete data
        // To see and delete data
        // To see and delete data
        app.get("/deleteUserData", async (req, res) => {
            return;
            let ans = await users.deleteMany({});
            res.send(ans);
        });
        app.get("/deleteAllProducts", async (req, res) => {
            return;
            let ans = await products.deleteMany({});
            res.send(ans);
        });
        app.get("/seeUserData", async (req, res) => {
            let ans = await users.find({}).toArray();
            res.send(ans);
        });
        app.get("/seeAllProducts", async (req, res) => {
            let ans = await products.find({}).toArray();
            res.send(ans);
        });
    } finally {
        // await client.close();
    }
}

// Started mainProcess() function
mainProcess().catch(console.dir);

app.get("/", (req, res) => {
    res.send("AssetFlow Server Running");
});

app.listen(port, () => {
    console.log(`Running on port http://localhost:${port}
------------------------------------`);
});
