import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Animated,
  Dimensions,
  TextInput,
  SafeAreaView
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const { width, height } = Dimensions.get('window');

const HealthProfileSetup = ({ theme, onComplete, onSkip, supabase, user, isExistingUser = false, onBackToProfile }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    age: '',
    height: '',
    weight: '',
    activityLevel: 'moderate',
    weightUnit: 'kg'
  });
  
  // Animation values
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current; // Start visible
  const progressAnim = useRef(new Animated.Value(0.25)).current; // Start at first step
  
  const steps = useMemo(() => [
    { title: 'Age', subtitle: 'How old are you?', key: 'age', type: 'number' },
    { title: 'Height', subtitle: 'What\'s your height?', key: 'height', type: 'height' },
    { title: 'Weight', subtitle: 'What\'s your weight?', key: 'weight', type: 'weight' },
    { title: 'Activity Level', subtitle: 'How active are you?', key: 'activityLevel', type: 'picker' }
  ], []);

  // Fetch existing health data for existing users
  useEffect(() => {
    if (isExistingUser && user?.id) {
      const fetchExistingData = async () => {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('height_cm, weight_kg, age, activity_level')
            .eq('id', user.id)
            .single();
          
          if (error) throw error;
          
          if (data) {
            setFormData({
              age: data.age?.toString() || '',
              height: data.height_cm?.toString() || '',
              weight: data.weight_kg?.toString() || '',
              activityLevel: data.activity_level || 'moderate'
            });
          }
        } catch (error) {
          // Silently handle error for production
        }
      };
      
      fetchExistingData();
    }
  }, [isExistingUser, user?.id, supabase]);

  // No initial animation needed since we start with visible values

  useEffect(() => {
    // Animate progress bar - faster
    Animated.spring(progressAnim, {
      toValue: (currentStep + 1) / steps.length,
      tension: 150,
      friction: 6,
      useNativeDriver: false, // Cannot use native driver for width
    }).start();
    
    // Animate slide - faster
    Animated.spring(slideAnim, {
      toValue: currentStep * -width,
      tension: 150,
      friction: 6,
      useNativeDriver: false, // Cannot use native driver for transform
    }).start();
  }, [currentStep]);

  const handleNext = async () => {
    if (currentStep < steps.length - 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCurrentStep(currentStep + 1);
    } else {
      // Complete setup
      await completeSetup();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCurrentStep(currentStep - 1);
    } else if (isExistingUser && onBackToProfile) {
      onBackToProfile();
    }
  };

  const completeSetup = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      
      // Convert units to standard format
      const heightCm = parseFloat(formData.height); // Always in cm now
      const weightKg = formData.weightUnit === 'lbs' ? 
        parseFloat(formData.weight) * 0.453592 : parseFloat(formData.weight);
      
      // Update profile in database
      const { error } = await supabase
        .from('profiles')
        .update({
          height_cm: formData.height ? parseFloat(formData.height) : null,
          weight_kg: formData.weight ? parseFloat(formData.weight) : null,
          age: formData.age ? parseInt(formData.age) : null,
          activity_level: formData.activityLevel
        })
        .eq('id', user.id);
      
      if (error) throw error;
      
      // Call completion callback
      onComplete();
    } catch (error) {
      // Silently handle error for production
    }
  };

  const updateFormData = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const renderInput = (step) => {
    switch (step.type) {
      case 'number':
        return (
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.textInput, { 
                backgroundColor: theme.card, 
                borderColor: theme.border,
                color: theme.text 
              }]}
              value={formData.age}
              onChangeText={(value) => updateFormData('age', value)}
              placeholder="Enter your age"
              placeholderTextColor={theme.sub}
              keyboardType="numeric"
              maxLength={3}
              returnKeyType="next"
              onSubmitEditing={handleNext}
            />
            <Text style={[styles.inputHint, { color: theme.sub }]}>
              years old
            </Text>
          </View>
        );
        
      case 'height':
        return (
          <View style={styles.inputContainer}>
            <Text style={[styles.unitLabel, { color: theme.sub }]}>
              Height in cm
            </Text>
            <TextInput
              style={[styles.textInput, { 
                backgroundColor: theme.card, 
                borderColor: theme.border,
                color: theme.text 
              }]}
              value={formData.height}
              onChangeText={(value) => updateFormData('height', value)}
              placeholder="Height in cm"
              placeholderTextColor={theme.sub}
              keyboardType="numeric"
              maxLength={5}
              returnKeyType="next"
              onSubmitEditing={handleNext}
            />
          </View>
        );
        
      case 'weight':
        return (
          <View style={styles.inputContainer}>
            <View style={styles.unitToggleContainer}>
              <Pressable
                style={[
                  styles.unitToggle,
                  formData.weightUnit === 'kg' && { backgroundColor: theme.primary }
                ]}
                onPress={() => updateFormData('weightUnit', 'kg')}
              >
                <Text style={[
                  styles.unitToggleText,
                  { color: formData.weightUnit === 'kg' ? '#fff' : theme.text }
                ]}>
                  kg
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.unitToggle,
                  formData.weightUnit === 'lbs' && { backgroundColor: theme.primary }
                ]}
                onPress={() => updateFormData('weightUnit', 'lbs')}
              >
                <Text style={[
                  styles.unitToggleText,
                  { color: formData.weightUnit === 'lbs' ? '#fff' : theme.text }
                ]}>
                  lbs
                </Text>
              </Pressable>
            </View>
            <TextInput
              style={[styles.textInput, { 
                backgroundColor: theme.card, 
                borderColor: theme.border,
                color: theme.text 
              }]}
              value={formData.weight}
              onChangeText={(value) => updateFormData('weight', value)}
              placeholder={`Weight in ${formData.weightUnit}`}
              placeholderTextColor={theme.sub}
              keyboardType="numeric"
              maxLength={5}
              returnKeyType="next"
              onSubmitEditing={handleNext}
            />
          </View>
        );
        
      case 'picker':
        const activityLevels = [
          { key: 'sedentary', label: 'Sedentary', icon: '🛋️', desc: 'Little or no exercise' },
          { key: 'light', label: 'Light', icon: '🚶‍♂️', desc: 'Light exercise 1-3 days/week' },
          { key: 'moderate', label: 'Moderate', icon: '🏃‍♂️', desc: 'Moderate exercise 3-5 days/week' },
          { key: 'active', label: 'Active', icon: '🏋️‍♂️', desc: 'Hard exercise 6-7 days/week' }
        ];
        
        return (
          <View style={styles.pickerContainer}>
            {activityLevels.map((level) => (
              <Pressable
                key={level.key}
                style={[
                  styles.activityOption,
                  { 
                    backgroundColor: formData.activityLevel === level.key ? theme.primary : theme.card,
                    borderColor: theme.border
                  }
                ]}
                onPress={() => updateFormData('activityLevel', level.key)}
              >
                <Text style={styles.activityIcon}>{level.icon}</Text>
                <View style={styles.activityTextContainer}>
                  <Text style={[
                    styles.activityLabel,
                    { color: formData.activityLevel === level.key ? '#fff' : theme.text }
                  ]}>
                    {level.label}
                  </Text>
                  <Text style={[
                    styles.activityDesc,
                    { color: formData.activityLevel === level.key ? 'rgba(255,255,255,0.8)' : theme.sub }
                  ]}>
                    {level.desc}
                  </Text>
                </View>
                {formData.activityLevel === level.key && (
                  <Text style={styles.activityCheck}>✓</Text>
                )}
              </Pressable>
            ))}
          </View>
        );
        
      default:
        return null;
    }
  };

  const canProceed = () => {
    const step = steps[currentStep];
    
    // For picker type, always allow proceeding
    if (step.type === 'picker') {
      return true;
    }
    
    // Check specific fields based on step
    if (step.key === 'age') {
      return formData.age && formData.age.toString().trim().length > 0;
    } else if (step.key === 'height') {
      return formData.height && formData.height.toString().trim().length > 0;
    } else if (step.key === 'weight') {
      return formData.weight && formData.weight.toString().trim().length > 0;
    }
    
    return false;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
             {/* Background gradient */}
       <LinearGradient
         colors={useMemo(() => theme.isDark ? 
           ['rgba(79, 125, 243, 0.1)', 'rgba(79, 125, 243, 0.05)'] : 
           ['rgba(79, 125, 243, 0.05)', 'rgba(79, 125, 243, 0.02)']
         , [theme.isDark])}
         style={styles.backgroundGradient}
       />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>
          Health Profile Setup
        </Text>
        <Text style={[styles.subtitle, { color: theme.sub }]}>
          Help us personalize your fitness tracking
        </Text>
      </View>
      
             {/* Progress bar */}
       <View style={styles.progressContainer}>
         <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
           <Animated.View 
             style={[
               styles.progressFill,
               { 
                 backgroundColor: theme.primary,
                 width: progressAnim.interpolate({
                   inputRange: [0, 1],
                   outputRange: ['0%', '100%']
                 })
               }
             ]} 
           />
         </View>
         <Text style={[styles.progressText, { color: theme.sub }]}>
           Step {currentStep + 1} of {steps.length}
         </Text>
         

       </View>
      
      {/* Content */}
      <ScrollView 
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentContainer}
      >
        <Animated.View 
          style={[
            styles.stepsContainer,
            {
              transform: [{ translateX: slideAnim }]
              // Removed opacity animation to keep inputs always visible
            }
          ]}
        >
          {steps.map((step, index) => (
            <View key={step.key} style={[styles.step, { width }]}>
              <View style={styles.stepHeader}>
                <Text style={[styles.stepTitle, { color: theme.text }]}>
                  {step.title}
                </Text>
                <Text style={[styles.stepSubtitle, { color: theme.sub }]}>
                  {step.subtitle}
                </Text>
              </View>
              
              {renderInput(step)}
            </View>
          ))}
        </Animated.View>
      </ScrollView>
      
      {/* Navigation */}
      <View style={styles.navigation}>
        <Pressable
          style={[styles.navButton, styles.backButton]}
          onPress={handleBack}
          disabled={currentStep === 0 && !isExistingUser}
        >
          <Text style={[styles.navButtonText, { color: theme.sub }]}>
            Back
          </Text>
        </Pressable>
        
        <Pressable
          style={[
            styles.navButton,
            styles.nextButton,
            { 
              backgroundColor: canProceed() ? theme.primary : theme.border,
              opacity: canProceed() ? 1 : 0.5
            }
          ]}
          onPress={handleNext}
          disabled={!canProceed()}
        >
          <Text style={[
            styles.navButtonText,
            { color: canProceed() ? '#fff' : theme.sub }
          ]}>
            {currentStep === steps.length - 1 ? 'Complete' : 'Next'}
          </Text>
        </Pressable>
      </View>
      
      {/* Skip option - only for new users */}
      {!isExistingUser && (
        <Pressable 
          style={styles.skipButton} 
          onPress={onSkip}
        >
          <Text style={[styles.skipText, { color: theme.sub }]}>
            Skip for now
          </Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 0 : 25,
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  header: {
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  progressContainer: {
    paddingHorizontal: 30,
    marginBottom: 30,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 20,
  },
  stepsContainer: {
    flexDirection: 'row',
  },
  step: {
    paddingHorizontal: 30,
    alignItems: 'center',
  },
  stepHeader: {
    alignItems: 'center',
    marginBottom: 40,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    opacity: 0.8,
  },
  inputContainer: {
    width: '100%',
    alignItems: 'center',
  },
  textInput: {
    width: '100%',
    height: 60,
    borderWidth: 2,
    borderRadius: 16,
    paddingHorizontal: 20,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  inputHint: {
    fontSize: 14,
    fontWeight: '500',
  },
  unitToggleContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    backgroundColor: 'rgba(79, 125, 243, 0.1)',
    borderRadius: 12,
    padding: 4,
  },
  unitToggle: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginHorizontal: 2,
  },
  unitToggleText: {
    fontSize: 16,
    fontWeight: '700',
  },
  pickerContainer: {
    width: '100%',
    gap: 12,
  },
  activityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 2,
  },
  activityIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  activityTextContainer: {
    flex: 1,
  },
  activityLabel: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  activityDesc: {
    fontSize: 14,
    fontWeight: '500',
  },
  activityCheck: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
  },
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
    paddingBottom: 20,
  },
  navButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    backgroundColor: 'transparent',
  },
  nextButton: {
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  skipButton: {
    alignItems: 'center',
    paddingBottom: 20,
  },
     skipText: {
     fontSize: 16,
     fontWeight: '600',
     textDecorationLine: 'underline',
   },
 });

export default HealthProfileSetup;
