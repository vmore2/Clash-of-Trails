# 🏃‍♂️ Clash of Trails - Fitness Territory Game

A React Native fitness app that turns your workouts into a territory-capturing game! Compete with friends by capturing hexagonal territories on a map while tracking your fitness activities.

## 🎯 What is Clash of Trails?

Clash of Trails is a gamified fitness app that combines:
- **Real-time GPS tracking** during workouts
- **Hexagonal territory capture** using H3 geospatial indexing
- **Group competitions** with friends and family
- **Fitness metrics** including steps, calories, and distance
- **Interactive maps** showing captured territories
- **Health profile management** with customizable goals

## ✨ Key Features

### 🗺️ Territory Capture
- **Live GPS tracking** during workouts
- **Hexagonal grid system** using H3 geospatial indexing
- **Real-time territory capture** as you move
- **Bulk capture** when stopping workouts
- **Visual territory ownership** on interactive maps

### 👥 Group System
- **Create or join groups** to compete with friends
- **Shared territory ownership** within groups
- **Group leaderboards** and statistics
- **Real-time group updates**

### 📊 Fitness Tracking
- **Step counting** with device sensors
- **Calorie calculation** based on activity intensity
- **Distance tracking** using GPS
- **Workout history** and progress
- **Health profile setup** with customizable goals

### 🚀 OTA Updates
- **Over-the-air updates** without app reinstalls
- **Instant feature delivery** to all users
- **Seamless update experience**

## 🛠️ Tech Stack

- **Frontend**: React Native with Expo
- **Maps**: React Native Maps + Web Map View
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Geospatial**: H3.js for hexagonal indexing
- **Location**: Expo Location services
- **Health**: React Native Health integration
- **Updates**: Expo Updates for OTA

## 📱 Platforms Supported

- ✅ **Android** - Full native support
- ✅ **iOS** - Full native support  
- ✅ **Web** - WebView-based map interface

## 🚀 Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Expo CLI (`npm install -g @expo/cli`)
- Supabase account and project

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd fitness-territory
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Supabase**
   - Create a new Supabase project
   - Copy your project URL and anon key
   - Update `lib/supabase.js` with your credentials

4. **Set up environment variables**
   - Create `.env` file with your Supabase credentials
   - Add any additional API keys needed

5. **Start the development server**
   ```bash
   npm start
   ```

### Database Setup

The app requires several database tables and policies. Run the provided SQL scripts in your Supabase SQL Editor:

1. **Basic setup**: `ensure-profiles.sql`
2. **Groups and members**: `fix-group-logic-complete.sql`
3. **Captured cells**: `fix-captured-cells-table.sql`
4. **RLS policies**: `fix-rls-policies-v2.sql`

## 🎮 How to Play

### 1. Set Up Your Profile
- Create a health profile with your fitness goals
- Choose your display name and color
- Set up step and calorie targets

### 2. Join or Create a Group
- Create a new group or join an existing one
- Groups allow you to compete and share territories

### 3. Start a Workout
- Tap the "Start Workout" button
- Allow location permissions
- The app will track your movement in real-time

### 4. Capture Territories
- As you move, hexagonal territories are automatically captured
- Territories are assigned to your group
- View captured areas on the interactive map

### 5. Compete and Improve
- See your group's territory on the map
- Track your fitness progress
- Compete with other groups for territory dominance

## 🗺️ Map Features

### Interactive Maps
- **Native maps** on mobile devices
- **Web-based maps** for cross-platform compatibility
- **Real-time territory visualization**
- **Group color coding**

### Territory System
- **H3 hexagonal grid** for consistent territory shapes
- **Real-time capture** during workouts
- **Bulk capture** when stopping
- **Territory ownership tracking**

## 👥 Group Management

### Creating Groups
- Enter a unique group name
- Group is automatically created and you're added as owner
- Share the group name with friends to join

### Joining Groups
- Enter the exact group name (case-sensitive)
- You'll be added as a member
- Start contributing to group territory

### Group Features
- **Shared territory ownership**
- **Member management**
- **Group statistics**
- **Real-time updates**

## 📊 Health & Fitness

### Health Profile
- **Customizable fitness goals**
- **Step count targets**
- **Calorie burn objectives**
- **Progress tracking**

### Activity Tracking
- **Real-time step counting**
- **GPS distance calculation**
- **Calorie estimation**
- **Workout history**

## 🔄 OTA Updates

The app supports over-the-air updates, allowing you to push new features without requiring users to reinstall:

```bash
# Publish an update
npm run update

# Or manually
npx expo publish
```

## 🐛 Troubleshooting

### Common Issues

**Group Join Problems**
- Ensure group name is typed exactly (case-sensitive)
- Check if you're properly authenticated
- Verify database setup and RLS policies

**Location Issues**
- Grant location permissions to the app
- Ensure GPS is enabled on your device
- Check if location services are working

**Map Display Issues**
- Restart the app if maps don't load
- Check internet connection for web maps
- Verify map API keys are configured

### Database Issues

If you encounter database errors:
1. Run the provided SQL fix scripts
2. Check RLS policies are properly applied
3. Verify table schemas match expected structure
4. Test database connection using the test script

## 🚀 Deployment

### Building for Production

```bash
# Build for Android
eas build --platform android

# Build for iOS
eas build --platform ios

# Build for both
eas build --platform all
```

### Publishing Updates

```bash
# Publish OTA update
npm run update

# Or use EAS
eas update --branch production
```

## 📁 Project Structure

```
fitness-territory/
├── App.js                 # Main application component
├── WebMapView.js         # Web-based map interface
├── MapViewScreen.js      # Native map screen
├── GroupGate.js          # Group management component
├── HealthProfileSetup.js # Health profile configuration
├── lib/
│   └── supabase.js      # Supabase client configuration
├── assets/               # App icons and images
└── *.sql                 # Database setup scripts
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the 0BSD License - see the LICENSE file for details.

## 🆘 Support

If you need help:
1. Check the troubleshooting section above
2. Review the database setup scripts
3. Check console logs for error messages
4. Verify your Supabase configuration

## 🎉 Acknowledgments

- **Expo** for the amazing React Native platform
- **Supabase** for the backend infrastructure
- **H3.js** for the hexagonal geospatial system
- **React Native Maps** for cross-platform mapping

---

**Happy territory capturing! 🏃‍♂️🗺️**
