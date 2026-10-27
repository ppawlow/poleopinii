// tools/post.js
const mongoose = require("mongoose");
const { POST_VISIBILITY, DEFAULT_ASSETS } = require("../config");

const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String, required: true },
  authorEmail: { type: String, required: true },
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  authorAvatar: { type: String, default: DEFAULT_ASSETS.avatar },
  content: { type: String, required: true },
  imageUrl: { type: String, default: null },
  visibility: { type: String, enum: POST_VISIBILITY, default: "public" },
  isAbuseReport: { type: Boolean, default: false },
  isModeratorLocked: { type: Boolean, default: false },
  abuseCategory: {
    type: String,
    enum: ["general", "copyright"],
    default: "general",
  },
  parentPostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Post",
    default: null,
  },
  likedBy: [{ type: String }],
  comments: [
    {
      author: { type: String, required: true },
      authorEmail: { type: String, required: true },
      authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      authorAvatar: { type: String, default: DEFAULT_ASSETS.avatar },
      content: { type: String, required: true },
      likedBy: [{ type: String }],
      createdAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
});
const Post = mongoose.model("Post", postSchema);

async function countAuthorPublicLikes(authorId) {
  try {
    const result = await mongoose.model("Post").aggregate([
      {
        $match: {
          authorId: new mongoose.Types.ObjectId(authorId),
          visibility: "public",
        },
      },
      { $project: { likesCount: { $size: { $ifNull: ["$likedBy", []] } } } },
      { $group: { _id: null, totalLikes: { $sum: "$likesCount" } } },
    ]);
    return result.length > 0 ? result[0].totalLikes : 0;
  } catch (err) {
    return 0;
  }
}

async function getScopedPosts(req, options = {}) {
  const limit = options.limit || 5;
  const skip = options.skip || 0;
  const scope = options.scope || "home";

  let currentUserId = null;
  let userFollowingIds = [];
  let exclusionIds = [];
  let userIsAdmin = false;

  if (req.session && req.session.user) {
    const dbUser = await mongoose.model("User").findById(req.session.user.id);
    if (dbUser) {
      currentUserId = dbUser._id;
      userFollowingIds = dbUser.following || [];
      const userBlockedIds = dbUser.blocks || [];
      const blockers = await mongoose
        .model("User")
        .find({ blocks: dbUser._id });
      exclusionIds = [...userBlockedIds, ...blockers.map((u) => u._id)];

      const { ADMINS } = require("../config");
      userIsAdmin = ADMINS.includes(dbUser._id.toString());
    }
  }

  const matchConditions = {
    authorId: { $exists: true, $nin: exclusionIds },
    isAbuseReport: { $ne: true },
  };

  if (scope === "single" && options.targetPostId) {
    matchConditions._id = new mongoose.Types.ObjectId(options.targetPostId);
  } else if (scope === "profile" && options.targetUserId) {
    matchConditions.authorId = {
      $eq: new mongoose.Types.ObjectId(options.targetUserId),
      $nin: exclusionIds,
    };
  } else if (scope === "following") {
    matchConditions.authorId = { $in: userFollowingIds, $nin: exclusionIds };
    matchConditions.visibility = { $ne: "private" };
  }

  if (scope !== "following") {
    matchConditions.$or = [
      { visibility: "public" },
      {
        visibility: "restricted",
        $or: [
          { authorId: currentUserId },
          { authorId: { $in: userFollowingIds } },
        ],
      },
      { visibility: "private", authorId: currentUserId },
    ];
  }

  const pipeline = [
    { $match: matchConditions },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from: "posts",
        localField: "parentPostId",
        foreignField: "_id",
        as: "parentPostDetails",
      },
    },
    {
      $unwind: { path: "$parentPostDetails", preserveNullAndEmptyArrays: true },
    },
    {
      $lookup: {
        from: "users",
        localField: "parentPostDetails.authorId",
        foreignField: "_id",
        as: "parentPostAuthorDetails",
      },
    },
    {
      $unwind: {
        path: "$parentPostAuthorDetails",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "authorId",
        foreignField: "_id",
        as: "authorDetails",
      },
    },
    { $unwind: { path: "$authorDetails", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "users",
        localField: "comments.authorId",
        foreignField: "_id",
        as: "commentAuthors",
      },
    },
    {
      $project: {
        title: 1,
        content: 1,
        imageUrl: 1,
        visibility: 1,
        createdAt: 1,
        authorId: 1,
        parentPostId: 1,
        isAbuseReport: 1,
        parentPostTitle: {
          $ifNull: ["$parentPostDetails.title", "Wpis bez tytułu"],
        },
        parentPostAuthor: {
          $ifNull: [
            "$parentPostAuthorDetails.name",
            "$parentPostDetails.author",
          ],
        },
        isLikedByMe: {
          $cond: {
            if: {
              $and: [
                { $ne: [{ $type: "$currentUserId" }, "missing"] },
                { $ne: [currentUserId, null] },
                { $isArray: "$likedBy" },
              ],
            },
            then: { $in: [{ $toString: currentUserId }, "$likedBy"] },
            else: false,
          },
        },
        likesCount: { $size: { $ifNull: ["$likedBy", []] } },
        authorDetails: {
          $cond: {
            if: {
              $and: [
                { $eq: ["$isAbuseReport", true] },
                { $eq: [userIsAdmin, false] },
              ],
            },
            then: {
              _id: "$authorDetails._id",
              avatarUrl: DEFAULT_ASSETS.avatar,
              isFullyVerified: false,
              name: "Anonimowy Użytkownik",
              alias: null,
            },
            else: {
              _id: "$authorDetails._id",
              avatarUrl: {
                $ifNull: ["$authorDetails.avatarUrl", DEFAULT_ASSETS.avatar],
              },
              isFullyVerified: {
                $and: [
                  { $eq: ["$authorDetails.isVerified", true] },
                  {
                    $eq: [
                      "$authorDetails.verificationTransferStatus",
                      "approved",
                    ],
                  },
                ],
              },
              name: { $ifNull: ["$authorDetails.name", "$author"] },
              alias: { $ifNull: ["$authorDetails.alias", null] },
            },
          },
        },
        comments: {
          $map: {
            input: "$comments",
            as: "c",
            in: {
              _id: "$$c._id",
              content: "$$c.content",
              likedBy: "$$c.likedBy",
              createdAt: "$$c.createdAt",
              authorId: "$$c.authorId",
              authorAvatar: {
                $let: {
                  vars: {
                    matchedUser: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$commentAuthors",
                            cond: { $eq: ["$$this._id", "$$c.authorId"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                  in: {
                    $ifNull: ["$$matchedUser.avatarUrl", DEFAULT_ASSETS.avatar],
                  },
                },
              },
              author: {
                $let: {
                  vars: {
                    matchedUser: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$commentAuthors",
                            cond: { $eq: ["$$this._id", "$$c.authorId"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                  in: { $ifNull: ["$$matchedUser.name", "$$c.author"] },
                },
              },
              isFullyVerified: {
                $let: {
                  vars: {
                    matchedUser: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$commentAuthors",
                            cond: { $eq: ["$$this._id", "$$c.authorId"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                  in: {
                    $and: [
                      { $eq: ["$$matchedUser.isVerified", true] },
                      {
                        $eq: [
                          "$$matchedUser.verificationTransferStatus",
                          "approved",
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  ];

  const posts = await mongoose.model("Post").aggregate(pipeline);
  const totalPosts = await mongoose
    .model("Post")
    .countDocuments(matchConditions);

  return { posts, totalPosts };
}

module.exports = {
  Post,
  countAuthorPublicLikes,
  getScopedPosts,
};
