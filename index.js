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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(
    cors({
        origin: [
            "http://localhost:5100",
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
            "https://a12-assetflow.firebaseapp.com",
            "https://a12-assetflow.web.app",
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
    // console.log("verifyToken");
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

    // const requestedUrl = req.originalUrl;
    // console.log("requestedUrl", requestedUrl);
    // console.log(req.user);
    // console.log("Request Validate", { decoded_Email, userEmail });

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
        const products_requested = client.db("a12-assetflow").collection("products-requested");
        const products_requested_custom = client
            .db("a12-assetflow")
            .collection("products-requested-custom");
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
            const requestedUrl = req.originalUrl;
            // console.log(requestedUrl);

            let decoded_Email = req.user?.userEmail;

            const userInfoResult = await userInfoFetch(decoded_Email);

            if (userInfoResult.userRole === "employee") {
                req.userInformation = userInfoResult;
                next();
            } else {
                return res.status(403).send({ message: "forbidden access" });
            }
        };

        const verifyUser_common = async (req, res, next) => {
            const requestedUrl = req.originalUrl;
            // console.log(requestedUrl);

            let decoded_Email = req.user?.userEmail;

            const userInfoResult = await userInfoFetch(decoded_Email);

            if (userInfoResult.userRole === "employee" || userInfoResult.userRole === "hr") {
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

            // console.log("userInformation authenticate", userInformation);

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

        // Stripe
        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
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
        app.get("/product", verifyToken, requestValidate, verifyUser_common, async (req, res) => {
            let decoded_Email = req.user?.userEmail;
            let hrEmail = req.userInformation;

            const userInformation = req?.userInformation;

            // console.log("userInformation product ", userInformation);
            /*
            HR hole tar email diye search dile e data eshe jabe. 
            Employee hole currentWorkingCompanyEmail diye search dite hbe.
            Employee and currentWorkingCompanyEmail o na thakle data jabe na.
            */

            let emailToQuery = null;
            if (userInformation?.userRole === "hr") {
                emailToQuery = userInformation?.userEmail;
            } else if (
                userInformation?.userRole === "employee" &&
                userInformation?.currentWorkingCompanyEmail
            ) {
                emailToQuery = userInformation?.currentWorkingCompanyEmail;
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

            // type : productType => Returnable/Non-returnable
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

                // console.log({ searchQuery });

                let productList = await products.find(searchQuery).sort(sortQuery).toArray();

                return res.send(productList);
            } else {
                return res.send([]);
            }
        });

        // All product Count
        // Security : Verify HR
        app.get("/product/count", verifyToken, requestValidate, verifyHR, async (req, res) => {
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

            if (emailToQuery) {
                let query = {};
                query.productAddedBy = emailToQuery;

                let productList = await products.find(query).toArray();

                return res.send({ success: true, totalProducts: productList.length });
            } else {
                return res.send({ success: false, totalProducts: 0 });
            }
        });

        // Products with limited stock
        // Security : Verify HR
        app.get(
            "/product/limited-stock",
            verifyToken,
            requestValidate,
            verifyHR,
            async (req, res) => {
                const userInformation = req.userInformation;
                const hr_email = userInformation.userEmail;

                let limitedStockQuery = {
                    productQuantity: { $lt: 10 },
                    productAddedBy: hr_email,
                };
                let limitedStock = await products
                    .find(limitedStockQuery)
                    .sort({ productQuantity: 1 })
                    .toArray();

                return res.send({ limitedStock });
            }
        );

        // Add Product
        // Security: Verify HR
        app.post("/product/add", verifyToken, requestValidate, verifyHR, async (req, res) => {
            const productInsertResult = await products.insertOne(req.body?.productInformation);

            res.send(productInsertResult);
        });

        // Make Custom Asset Request
        // Security: Verify Employee
        app.post(
            "/custom-product/add",
            verifyToken,
            requestValidate,
            verifyEmployee,
            async (req, res) => {
                const productInsertResult = await products_requested_custom.insertOne(
                    req.body?.productInformation
                );

                res.send(productInsertResult);
            }
        );

        // Update Custom Asset Request
        // Security: Verify Employee
        app.post(
            "/custom-product/update",
            verifyToken,
            requestValidate,
            verifyEmployee,
            async (req, res) => {
                const productInfo = req.body.productInformation;
                const updatedProductData = {
                    $set: {
                        productName: productInfo?.productName,
                        productType: productInfo?.productType,
                        productPrice: productInfo?.productPrice,
                        productUrgencyLevel: productInfo?.productUrgencyLevel,
                        productNotes: productInfo?.productNotes,
                        productDeliveryDeadline: productInfo?.productDeliveryDeadline,
                        productImage: productInfo?.productImage,
                    },
                };

                const updatedProductData_result = await products_requested_custom.updateOne(
                    { _id: new ObjectId(productInfo._id) },
                    updatedProductData,
                    { upsert: false }
                );

                res.send(updatedProductData_result);
            }
        );

        // Update Product
        // Security: Verify HR
        app.post("/product/update", verifyToken, requestValidate, verifyHR, async (req, res) => {
            console.log(req.body.productInformation);

            const productInfo = req.body.productInformation;

            const updatedProductData = {
                $set: {
                    productName: productInfo?.productName,
                    productQuantity: productInfo?.productQuantity,
                    productType: productInfo?.productType,
                },
            };

            const updatedProductData_result = await products.updateOne(
                { _id: new ObjectId(productInfo._id) },
                updatedProductData,
                { upsert: false }
            );

            res.send(updatedProductData_result);
        });

        // Delete Product
        // Security: Verify HR
        app.delete("/product/delete", verifyToken, requestValidate, verifyHR, async (req, res) => {
            let targetedAssetId = req.query.targetedAssetId;

            let deleteQuery = { _id: new ObjectId(targetedAssetId) };
            const deleteResult = await products.deleteOne(deleteQuery);

            res.send(deleteResult);
        });

        // Request for asset
        // Security : Employee
        app.post(
            "/product/request/add",
            verifyToken,
            requestValidate,
            verifyEmployee,
            async (req, res) => {
                console.log(req.body?.requestedProductInfo);

                const requestedProductInfo = req.body?.requestedProductInfo;

                const requestInsertResult = await products_requested.insertOne(
                    requestedProductInfo
                );

                res.send(requestInsertResult);

                // const existingProduct = await products_requested.findOne({
                //     productId: requestedProductInfo?.productId,
                //     userEmail: requestedProductInfo?.userEmail,
                // });

                // if (existingProduct?.productId !== requestedProductInfo?.productId) {
                //     const requestInsertResult = await products_requested.insertOne(
                //         requestedProductInfo
                //     );

                //     res.send(requestInsertResult);
                // } else {
                //     res.send({ acknowledged: false, productExists: true });
                // }
            }
        );

        // Requested Products list
        // Security : Employee and HR
        app.get(
            "/product/request/list",
            verifyToken,
            requestValidate,
            verifyUser_common,
            async (req, res) => {
                const userInformation = req.userInformation;

                let queryReq = req.query;
                let searchQuery = {};

                if (userInformation?.userRole === "hr") {
                    searchQuery.currentWorkingCompanyEmail = userInformation?.userEmail;
                } else if (
                    userInformation?.userRole === "employee" &&
                    userInformation?.currentWorkingCompanyEmail
                ) {
                    searchQuery.userEmail = userInformation?.userEmail;
                    searchQuery.currentWorkingCompanyEmail =
                        userInformation?.currentWorkingCompanyEmail;
                } else {
                    searchQuery.userEmail = "";
                }

                // title : productName
                if (queryReq?.nameEmailSearch) {
                    // searchQuery.userEmail = { $regex: new RegExp(queryReq?.nameEmailSearch, "i") };
                    // searchQuery.userFullName = {
                    //     $regex: new RegExp(queryReq?.nameEmailSearch, "i"),
                    // };

                    const searchPattern = new RegExp(queryReq.nameEmailSearch, "i");

                    searchQuery.$or = [
                        { userEmail: { $regex: searchPattern } },
                        { userFullName: { $regex: searchPattern } },
                    ];
                }

                // title : productName
                if (queryReq?.title) {
                    searchQuery.productName = { $regex: new RegExp(queryReq?.title, "i") };
                }

                // type : productType => Returnable/Non-returnable
                if (queryReq?.type) {
                    searchQuery.productType = queryReq?.type;
                }

                // approvalStatus => returnable/non_returnable
                if (queryReq?.requestStatus) {
                    searchQuery.approvalStatus = queryReq?.requestStatus;
                }

                let requestedProductsList = await products_requested.find(searchQuery).toArray();

                return res.send(requestedProductsList);
            }
        );

        // Requested Products list
        // Security : Employee and HR
        app.get(
            "/custom-product/list",
            verifyToken,
            requestValidate,
            verifyUser_common,
            async (req, res) => {
                const userInformation = req.userInformation;

                let queryReq = req.query;
                let searchQuery = {};

                if (userInformation?.userRole === "hr") {
                    searchQuery.currentWorkingCompanyEmail = userInformation?.userEmail;
                } else if (
                    userInformation?.userRole === "employee" &&
                    userInformation?.currentWorkingCompanyEmail
                ) {
                    searchQuery.userEmail = userInformation?.userEmail;
                    searchQuery.currentWorkingCompanyEmail =
                        userInformation?.currentWorkingCompanyEmail;
                } else {
                    searchQuery.userEmail = "";
                }

                let customRequestList = await products_requested_custom.find(searchQuery).toArray();

                return res.send(customRequestList);
            }
        );

        // Cancel request from Requested Products list
        // Security : Employee
        app.delete(
            "/product/request/cancel",
            verifyToken,
            requestValidate,
            verifyEmployee,
            async (req, res) => {
                let targetedAssetId = req.query.targetedAssetId;
                console.log({ targetedAssetId });
                let deleteQuery = { _id: new ObjectId(targetedAssetId) };
                const deleteResult = await products_requested.deleteOne(deleteQuery);

                res.send(deleteResult);
            }
        );

        // Approve Request from Requested Products List
        // Security HR
        app.post(
            "/product/request/approve",
            verifyToken,
            requestValidate,
            verifyHR,
            async (req, res) => {
                const productInfo = req.body.productInfo;

                const updatedProductData = {
                    $set: {
                        approvalDate: productInfo?.approvalDate,
                        approvalStatus: "approved",
                    },
                };

                const updatedProductData_result = await products_requested.updateOne(
                    { _id: new ObjectId(productInfo._id) },
                    updatedProductData,
                    { upsert: false }
                );

                // Decrease amount in products db
                const mainProductData = await products.findOne({
                    _id: new ObjectId(productInfo.productId),
                });

                const updatedMainProductData = {
                    $set: {
                        productQuantity: mainProductData.productQuantity - 1,
                    },
                };

                const updatedMainProductData_result = await products.updateOne(
                    { _id: new ObjectId(productInfo.productId) },
                    updatedMainProductData,
                    { upsert: false }
                );

                res.send(updatedProductData_result);
                // res.send({});
            }
        );

        // Approve Request from Custom Requests Page
        // Security HR
        app.post(
            "/custom-product/approve",
            verifyToken,
            requestValidate,
            verifyHR,
            async (req, res) => {
                const productInfo = req.body.productInfo;

                const updatedProductData = {
                    $set: {
                        approvalDate: productInfo?.approvalDate,
                        approvalStatus: "approved",
                    },
                };

                const updatedProductData_result = await products_requested_custom.updateOne(
                    { _id: new ObjectId(productInfo._id) },
                    updatedProductData,
                    { upsert: true }
                );

                res.send(updatedProductData_result);
                // res.send({});
            }
        );

        // Reject Request from Requested Products List
        // Security HR
        app.post(
            "/product/request/reject",
            verifyToken,
            requestValidate,
            verifyHR,
            async (req, res) => {
                const productInfo = req.body.productInfo;

                const updatedProductData = {
                    $set: {
                        approvalDate: null,
                        approvalStatus: "rejected",
                    },
                };

                const updatedProductData_result = await products_requested.updateOne(
                    { _id: new ObjectId(productInfo._id) },
                    updatedProductData,
                    { upsert: false }
                );

                console.log(productInfo, updatedProductData_result);

                res.send(updatedProductData_result);
            }
        );

        // Reject Request from Custom Requests Page
        // Security HR
        app.post(
            "/custom-product/reject",
            verifyToken,
            requestValidate,
            verifyHR,
            async (req, res) => {
                const productInfo = req.body.productInfo;

                const updatedProductData = {
                    $set: {
                        approvalDate: null,
                        approvalStatus: "rejected",
                    },
                };

                const updatedProductData_result = await products_requested_custom.updateOne(
                    { _id: new ObjectId(productInfo._id) },
                    updatedProductData,
                    { upsert: false }
                );

                res.send(updatedProductData_result);
            }
        );

        // Return Product from Requested Products
        // Security : Employee
        app.post(
            "/product/request/return",
            verifyToken,
            requestValidate,
            verifyEmployee,
            async (req, res) => {
                const productInfo = req.body.productInfo;

                const updatedProductData = {
                    $set: {
                        approvalDate: null,
                        approvalStatus: "returned",
                    },
                };

                const updatedProductData_result = await products_requested.updateOne(
                    { _id: new ObjectId(productInfo._id) },
                    updatedProductData,
                    { upsert: false }
                );

                // Decrease amount in products db
                const mainProductData = await products.findOne({
                    _id: new ObjectId(productInfo.productId),
                });

                const updatedMainProductData = {
                    $set: {
                        productQuantity: mainProductData.productQuantity + 1,
                    },
                };

                const updatedMainProductData_result = await products.updateOne(
                    { _id: new ObjectId(productInfo.productId) },
                    updatedMainProductData,
                    { upsert: false }
                );

                res.send(updatedProductData_result);
                // res.send({});
            }
        );

        // app.post("/product/custom-request");

        // Users Profile update
        // Security: Employee + HR
        app.post(
            "/users/updateProfile",
            verifyToken,
            requestValidate,
            verifyUser_common,
            async (req, res) => {
                // console.log("updateProfile", req.user?.userEmail, req.body.profileInformation);

                let decoded_user_Email = req.user?.userEmail;

                const updatedEmployeeData = {
                    $set: {
                        userFullName: req.body?.profileInformation?.userFullName,
                        userDob: req.body?.profileInformation?.userDob,
                    },
                };

                const updatedEmployeeData_result = await users.updateOne(
                    { userEmail: decoded_user_Email },
                    updatedEmployeeData,
                    { upsert: false }
                );

                const updated_userInfo = await userInformationFetch(decoded_user_Email);

                res.send({ updatedEmployeeData_result, userInformation: updated_userInfo });
            }
        );

        // Users Profile update
        // Security: Employee + HR
        app.post(
            "/users/updatePayment",
            verifyToken,
            requestValidate,
            verifyHR,
            async (req, res) => {
                // console.log("updateProfile", req.user?.userEmail, req.body.profileInformation);

                let decoded_user_Email = req.user?.userEmail;
                let packageInfo = req.body?.packageInfo;

                let userInformationOld = req.userInformation;

                let updatedMembershipLimit =
                    userInformationOld.currentMemberShipLimit + packageInfo.member;

                const updatedPaymentData = {
                    $set: {
                        currentMemberShipLimit: updatedMembershipLimit,
                    },
                };

                const updatedPaymentData_result = await users.updateOne(
                    { userEmail: decoded_user_Email },
                    updatedPaymentData,
                    { upsert: false }
                );

                const userInformation = await userInformationFetch(decoded_user_Email);

                res.send({ userInformation, updatedPaymentData_result });
            }
        );

        // Available Users who can be booked
        app.get("/users/available", verifyToken, requestValidate, verifyHR, async (req, res) => {
            let availableEmployee = await users
                .find({ currentWorkingCompanyEmail: null, userRole: "employee" })
                .toArray();
            res.send(availableEmployee);
        });

        // Subordinate employees
        // Security HR
        app.get("/users/subordinates", verifyToken, requestValidate, verifyHR, async (req, res) => {
            let decoded_Email = req.user?.userEmail;
            let hrEmail = decoded_Email;

            let subordinates = await users
                .find({ currentWorkingCompanyEmail: hrEmail, userRole: "employee" })
                .toArray();
            res.send(subordinates);
        });

        // My team
        // Security Employee
        app.get("/users/myteam", verifyToken, requestValidate, verifyEmployee, async (req, res) => {
            let hrEmail = req.userInformation.currentWorkingCompanyEmail;

            if (!hrEmail) {
                return res.send([]);
            }

            let query = {
                $or: [{ currentWorkingCompanyEmail: hrEmail }, { userEmail: hrEmail }],
            };
            console.log("myTeam", query);
            let teamMembers = await users.find(query).toArray();

            res.send(teamMembers);
        });

        // Subordinate employee Remove
        // Security HR
        app.delete(
            "/users/subordinates/remove",
            verifyToken,
            requestValidate,
            verifyHR,
            async (req, res) => {
                let decoded_Hr_Email = req.user?.userEmail;
                let targetedUserEmail = req?.query?.targetedUserEmail;

                console.log({ decoded_Hr_Email, targetedUserEmail });

                // Update information in targetedUserEmail
                const updatedEmployeeData = {
                    $set: {
                        currentWorkingCompanyEmail: null,
                        currentWorkingCompanyImage: null,
                        currentWorkingCompanyName: null,
                    },
                };

                const updatedEmployeeData_result = await users.updateOne(
                    { userEmail: targetedUserEmail },
                    updatedEmployeeData,
                    { upsert: false }
                );

                // Update information in decoded_Hr_Email
                const userInfoResult_hr = await userInfoFetch(decoded_Hr_Email);

                const remainingEmployees = userInfoResult_hr?.currentEmployees.filter(
                    (employeeEmail) => employeeEmail !== targetedUserEmail
                );

                const updatedHrData = {
                    $set: {
                        currentEmployees: remainingEmployees,
                    },
                };

                const updatedHrData_Result = await users.updateOne(
                    { userEmail: decoded_Hr_Email },
                    updatedHrData,
                    { upsert: false }
                );
                res.send({ updatedHrData_Result, updatedEmployeeData_result });
            }
        );

        // users booking
        // Security HR
        app.post("/users/booking", verifyToken, requestValidate, verifyHR, async (req, res) => {
            let decoded_Email = req.user?.userEmail;
            console.log("users booking", req.body?.employeesToBook);

            const userInfoResult_hr = await userInfoFetch(decoded_Email);

            console.log(userInfoResult_hr);
            // return;

            // Booked user filed updating
            // array containing employee email
            const employeesToBook = req.body?.employeesToBook;

            const userBooking_Result = await users.updateMany(
                { userEmail: { $in: employeesToBook } },
                {
                    $set: {
                        currentWorkingCompanyEmail: userInfoResult_hr?.userEmail,
                        currentWorkingCompanyImage: userInfoResult_hr?.userCompanyLogo,
                        currentWorkingCompanyName: userInfoResult_hr?.userCompanyName,
                    },
                }
            );

            // hr info updating
            const updatedHrData = {
                $set: {
                    currentEmployees: [...userInfoResult_hr?.currentEmployees, ...employeesToBook],
                },
            };

            const updatedHrData_Result = await users.updateOne(
                { userEmail: decoded_Email },
                updatedHrData,
                { upsert: false }
            );

            // const userInformation = req.body;
            // const query = { userEmail: userInformation?.userEmail };

            /*
             * je hr request dise tar currentEmployees e old gula and new gula push korte hbe AND hr er package limit decrease korte hbe.
            * je employee id ahsce tader 
                    currentWorkingCompanyEmail : email_hr
                    currentWorkingCompanyImage : userCompanyLogo
                    currentWorkingCompanyName : userCompanyName
             */

            res.send({ userBooking_Result, updatedHrData_Result });
        });

        // MembershipLimit and Current Employee Lenght
        // Security HR
        app.get("/membership/check", verifyToken, requestValidate, verifyHR, async (req, res) => {
            let decoded_Email = req.user?.userEmail;

            const userInfoResult = await userInfoFetch(decoded_Email);

            // console.log("membership check ", userInfoResult);

            res.send({
                success: true,
                currentMemberShipLimit: userInfoResult?.currentMemberShipLimit,
                totalCurrentEmployees: userInfoResult?.currentEmployees.length,
            });
        });

        // To see and bulk delete
        // To see and bulk delete
        // To see and bulk delete
        app.get("/deleteUserData", async (req, res) => {
            return;
            return;
            let ans = await users.deleteMany({});
            res.send(ans);
        });
        app.get("/deleteAllProducts", async (req, res) => {
            // all PRODUCT delete
            return;
            return;
            let ans = await products.deleteMany({});
            res.send(ans);
        });
        app.get("/deleteAllProductsRequest", async (req, res) => {
            // all REQUESTED PRODUCT delete
            return;
            let ans = await products_requested.deleteMany({});
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
        app.get("/seeAllProductsRequest", async (req, res) => {
            let ans = await products_requested.find({}).toArray();
            res.send(ans);
        });
        app.get("/seeAllCustomRequest", async (req, res) => {
            let ans = await products_requested_custom.find({}).toArray();
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
