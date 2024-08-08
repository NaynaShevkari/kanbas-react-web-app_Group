import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import * as questionClient from './QuestionClient';
import * as answerClient from './AnswerClient';
import * as quizClient from './client';
import { setQuestions as setQuestionsAction } from './QuestionsReducer';
import { addAnswer, updateAnswer } from './AnswerReducer';
import './style.css';

interface Question {
  title: string;
  _id: string;
  text: string;
  points: number;
  type: 'multiple-choice' | 'fill-in-the-blank' | 'true-false';
  options?: string[];
  answers: string[];
}

interface Answers {
  [key: string]: string;
}

interface Quiz {
  title: string;
  multipleAttempts: boolean;
  attempts: number;
  timeLimit: number;
  userAttempts: string[];
}

export default function QuizPreview() {
  const { cid, qid } = useParams<{ cid: string; qid: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [answers, setAnswers] = useState<Answers>({});
  const [score, setScore] = useState<number | null>(null);
  const [incorrectQuestions, setIncorrectQuestions] = useState<string[]>([]);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [quizDetails, setQuizDetails] = useState<Quiz | null>(null);
  const [submitCount, setSubmitCount] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(60);
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [incorrectAnswers, setIncorrectAnswers] = useState<{
    [key: string]: string;
  }>({});
  const [canAttempt, setCanAttempt] = useState<boolean>(true);
  const { currentUser } = useSelector((state: any) => state.accountReducer);
  const questions = useSelector((state: any) =>
    state.questionsReducer.questions.filter(
      (question: any) => question.quiz === qid
    )
  );

  const fetchQuestions = async () => {
    try {
      const fetchedQuestions = await questionClient.findAllQuestionsByQuizId(
        qid as string
      );
      const questionsWithOptions = fetchedQuestions.map(
        (question: Question) => {
          if (
            question.type === 'true-false' &&
            (!question.options || question.options.length === 0)
          ) {
            return { ...question, options: ['True', 'False'] };
          }
          return question;
        }
      );
      dispatch(setQuestionsAction(questionsWithOptions));
    } catch (error) {
      console.error('Error fetching questions:', error);
    }
  };

  const fetchQuizDetails = async () => {
    try {
      const fetchedQuizDetails = await quizClient.findQuiz(
        cid as string,
        qid as string
      );
      setQuizDetails(fetchedQuizDetails);
      const attemptsCheck = await quizClient.checkAttempts(qid as string, currentUser?._id);
      setCanAttempt(attemptsCheck.canAttempt);
      if (fetchedQuizDetails.multipleAttempts) {
        setAttemptsLeft(fetchedQuizDetails.attempts - attemptsCheck.attempts);
      } else {
        setAttemptsLeft(1 - attemptsCheck.attempts);
      }
      if (fetchedQuizDetails.timeLimit) {
        setTimeLeft(fetchedQuizDetails.timeLimit * 60);
      }
    } catch (error) {
      console.error('Error fetching quiz details:', error);
    }
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
  };

  useEffect(() => {
    fetchQuestions();
    fetchQuizDetails();
  }, [qid]);

  useEffect(() => {
    if (timeLeft > 0 && canAttempt && submitCount === 0) {
      const timerInterval = setInterval(() => {
        setTimeLeft((prevTime) => prevTime - 1);
      }, 1000);
      setTimer(timerInterval);
      return () => clearInterval(timerInterval);
    } else if (timeLeft === 0) {
      handleSubmit();
    }
  }, [timeLeft, canAttempt, submitCount]);

  const handleAnswerChange = (questionId: string, answer: string) => {
    setAnswers((prevAnswers) => ({
      ...prevAnswers,
      [questionId]: answer,
    }));
  };

  const handleSubmit = async () => {
    if (timer) {
      clearInterval(timer);
      setTimer(null);
    }

    let newScore = 0;
    const incorrect: string[] = [];
    const incorrectAns: { [key: string]: string } = {};
    const answerDataArray: any[] = [];

    questions.forEach((question: Question) => {
      if (answers[question._id] === question.answers[0]) {
        newScore += question.points;
      } else {
        incorrect.push(question._id);
        incorrectAns[question._id] = answers[question._id];
      }
      const answerData = {
        userId: currentUser?._id,
        quizId: qid as string,
        questionId: question._id,
        answer: answers[question._id],
        score: newScore,
        attemptNumber: submitCount + 1,
        submittedAt: new Date(),
      };
      console.log('Answer Data:', answerData);

      answerDataArray.push(answerData);
    });

    try {
      for (const answerData of answerDataArray) {
        console.log('Answer data for question :' + JSON.stringify(answerData));
        try {
          const existingAnswer = await answerClient.fetchAnswer(
            answerData.userId,
            answerData.questionId
          );
          console.log(
            'Answer data for question from db :' + JSON.stringify(existingAnswer)
          );
          if (existingAnswer) {
            console.log('Updating answers: ' + answerData);
            await answerClient.updateAnswer(
              answerData,
              answerData.questionId,
              currentUser._id
            );
            dispatch(updateAnswer(answerData));
          } else {
            await answerClient.createAnswer(
              answerData.questionId as string,
              answerData as any
            );
            dispatch(addAnswer(answerData));
          }
        } catch (error: any) {
          if (error.response && error.response.status === 404) {
            await answerClient.createAnswer(
              answerData.questionId as string,
              answerData as any
            );
            dispatch(addAnswer(answerData));
          } else {
            console.error('Error processing answer:', error);
          }
        }
      }

      // Update quiz with user attempt
      const updatedQuiz = {
        ...quizDetails,
        userAttempts: [...(quizDetails?.userAttempts || []), currentUser?._id],
      } as Quiz;
      await quizClient.updateQuiz(updatedQuiz);

    } catch (error) {
      console.error('Error storing answers:', error);
    }

    setScore(newScore);
    setScores([...scores, newScore]);
    setIncorrectQuestions(incorrect);
    setIncorrectAnswers(incorrectAns);

    window.scrollTo({ top: 0, behavior: 'smooth' });

    setSubmitCount((prevCount) => prevCount + 1);
    console.log('Quiz submitted successfully:', answers, 'Score:', newScore);

    setTimeLeft(60);
  };

  const handleRetakeQuiz = () => {
    setAnswers({});
    setScore(null);
    setIncorrectQuestions([]);
    setTimeLeft(60);
  };

  const getScoreComment = (percentage: number) => {
    if (percentage === 100) {
      return "Perfect score! You're a genius!";
    } else if (percentage >= 75) {
      return 'Great job! Almost perfect!';
    } else if (percentage >= 50) {
      return "Not bad! You're getting there!";
    } else if (percentage >= 25) {
      return 'You can do better! Keep trying!';
    } else {
      return 'Well, at least you tried. Better luck next time!';
    }
  };

  const handleViewResults = async () => {
    try {
      if (quizDetails?.multipleAttempts) {
        const updatedQuiz: Quiz = {
          ...quizDetails,
          userAttempts: Array(quizDetails.attempts).fill(currentUser?._id),
        } as Quiz;
        await quizClient.updateQuiz(updatedQuiz);
        setQuizDetails(updatedQuiz);
      } else {
        const updatedQuiz: Quiz = {
          ...quizDetails,
          userAttempts: [currentUser?._id],
        } as Quiz;
        await quizClient.updateQuiz(updatedQuiz);
        setQuizDetails(updatedQuiz);
      }
      setAttemptsLeft(0);
      setCanAttempt(false);
      navigate(`/Kanbas/Courses/${cid}/Quizzes/${qid}/results`);
    } catch (error) {
      console.error('Error updating quiz attempts:', error);
    }
  };

  const handleEditQuiz = () => {
    navigate(`/Kanbas/Courses/${cid}/Quizzes/${qid}/editor`);
  };

  const totalPoints = questions.reduce(
    (acc: number, q: Question) => acc + q.points,
    0
  );
  const percentageScore = score !== null ? (score / totalPoints) * 100 : 0;
  const scoreComment = getScoreComment(percentageScore);

  useEffect(() => {
    if (quizDetails) {
      if (!quizDetails.multipleAttempts) {
        setAttemptsLeft(1);
        setSubmitCount(0);
        localStorage.setItem(`quiz-${qid}-attemptsLeft`, '1');
      } else {
        const savedAttemptsLeft = localStorage.getItem(
          `quiz-${qid}-attemptsLeft`
        );
        setAttemptsLeft(
          savedAttemptsLeft ? parseInt(savedAttemptsLeft) : quizDetails.attempts
        );
      }
    }
  }, [quizDetails?.multipleAttempts]);

  return (
    <div className='container mt-5'>
      {score !== null && (
        <div className='mt-4'>
          <div className='card text-center'>
            <div className='card-header'>
              <h3 className='card-title'>Total Score</h3>
            </div>
            <div className='card-body'>
              <h1 className='display-4'>{score}</h1>
              <p className='card-text'>
                You scored {score} points out of a possible {totalPoints}.<br />
              </p>
            </div>
            <div className='card-footer text-muted'>{scoreComment}</div>
          </div>
        </div>
      )}
      <h1>{quizDetails?.title}</h1>
      {!canAttempt ? (
        <div className='alert alert-warning' role='alert'>
          Unable to take the quiz. You have used all your attempts.
          <button
            className='btn btn-danger view-results-btn mt-3'
            onClick={handleViewResults}
          >
            View Results
          </button>
        </div>
      ) : (
        attemptsLeft !== null && attemptsLeft > 0 && submitCount === 0 ? (
          <>
            {submitCount <
              (quizDetails?.multipleAttempts ? quizDetails.attempts : 1) && (
                <div className='alert alert-info' role='alert'>
                  Time left: {formatTime(timeLeft)}
                </div>
              )}
            {quizDetails?.multipleAttempts ? (
              attemptsLeft > 0 ? (
                <div className='alert alert-warning' role='alert'>
                  This quiz allows multiple attempts. Attempts left: {attemptsLeft}
                </div>
              ) : (
                <div className='alert alert-warning' role='alert'>
                  Unable to retake the quiz. You have used all your attempts.
                </div>
              )
            ) : (
              <div className='alert alert-warning' role='alert'>
                You are only allowed to take this quiz once.
              </div>
            )}
            {currentUser?.role !== 'STUDENT' && (
              <div className='alert alert-info' role='alert'>
                This is a preview of the published version of the quiz.
              </div>
            )}
            <h2>Quiz Instructions</h2>
            {questions.map((question: Question, index: number) => (
              <div
                key={question._id}
                className={`card mb-3 ${
                  incorrectQuestions.includes(question._id) ? 'border-danger' : ''
                }`}
              >
                <div className='card-header d-flex justify-content-between'>
                  <h3>Question {index + 1}</h3>
                  <span>{question.points} pts</span>
                </div>
                <div className='card-body'>
                  <h4>{question.title}</h4>
                  <p>{question.text}</p>
                  {question.type === 'multiple-choice' && (
                    <div className='list-group'>
                      {question.options?.map((option) => (
                        <label
                          key={option}
                          className='list-group-item d-flex align-items-center'
                        >
                          <input
                            type='radio'
                            name={`question-${question._id}`}
                            value={option}
                            checked={answers[question._id] === option}
                            onChange={() => handleAnswerChange(question._id, option)}
                            className='me-2'
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  )}
                  {question.type === 'true-false' && (
                    <div className='list-group'>
                      <label className='list-group-item d-flex align-items-center'>
                        <input
                          type='radio'
                          name={`question-${question._id}`}
                          value='true'
                          checked={answers[question._id] === 'true'}
                          onChange={() => handleAnswerChange(question._id, 'true')}
                          className='me-2'
                        />
                        True
                      </label>
                      <label className='list-group-item d-flex align-items-center'>
                        <input
                          type='radio'
                          name={`question-${question._id}`}
                          value='false'
                          checked={answers[question._id] === 'false'}
                          onChange={() => handleAnswerChange(question._id, 'false')}
                          className='me-2'
                        />
                        False
                      </label>
                    </div>
                  )}
                  {question.type === 'fill-in-the-blank' && (
                    <div className='mb-3'>
                      <input
                        type='text'
                        className='form-control'
                        value={answers[question._id] || ''}
                        onChange={(e) =>
                          handleAnswerChange(question._id, e.target.value)
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className='d-flex justify-content-between mt-3'>
              {currentUser?.role !== 'STUDENT' && (
                <button onClick={handleEditQuiz} className='btn btn-secondary'>
                  Keep Editing This Quiz
                </button>
              )}
              {(quizDetails?.multipleAttempts
                  ? submitCount < quizDetails.attempts
                  : submitCount < 1) && timeLeft > 0 ? (
                <button onClick={handleSubmit} className='btn btn-primary'>
                  Submit Quiz
                </button>
              ) : (
                <button
                  onClick={handleRetakeQuiz}
                  className='btn btn-warning'
                  disabled
                >
                  You Can't Retake Quiz (Attempts left: 0)
                </button>
              )}
              {submitCount > 0 && (
                <button
                  className='btn btn-danger view-results-btn'
                  onClick={handleViewResults}
                >
                  View Results
                </button>
              )}
            </div>
          </>
        ) : (
          <div className='alert alert-warning' role='alert'>
            <button
              className='btn btn-danger view-results-btn mt-3'
              onClick={handleViewResults}
            >
              View Results
            </button>
          </div>
        )
      )}
      {score !== null && (
        <>
          {score > 0 && (
            <div className='mt-5'>
              <h3> Score: {score}</h3>
              <ul className='list-group'>
                {Object.entries(answers).map(([questionId, answer]) => (
                  <li key={questionId} className='list-group-item'>
                    <strong>
                      Question{' '}
                      {questions.findIndex((q: any) => q._id === questionId) + 1}
                      :
                    </strong>{' '}
                    {answer}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Object.keys(incorrectAnswers).length > 0 && (
            <div className='mt-5'>
              <h3>Incorrect Answers and Correct Answers:</h3>
              <ul className='list-group'>
                {Object.entries(incorrectAnswers).map(
                  ([questionId, userAnswer]) => (
                    <li key={questionId} className='list-group-item'>
                      <strong>
                        Question{' '}
                        {questions.findIndex((q: any) => q._id === questionId) + 1}
                        :
                      </strong>{' '}
                      Your answer: {userAnswer}, Correct answer:{' '}
                      {questions.find((q: any) => q._id === questionId)
                        ?.answers[0]}
                    </li>
                  )
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
